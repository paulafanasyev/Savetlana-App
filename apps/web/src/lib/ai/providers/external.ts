/**
 * External AI provider adapter.
 *
 * Speaks an OpenAI-compatible /chat/completions endpoint. This is the ONLY
 * place that holds an outbound API key, and the key comes from env, never from
 * the request, the client, or git.
 *
 * SECURITY (spec §83, §85): payloads are minimized + redacted by the guard
 * before they ever reach here.
 */
import { env } from "../../env";
import type {
  AiCompleteRequest,
  AiCompleteResponse,
  AiEmbeddingRequest,
  AiEmbeddingResponse,
  AiProvider,
} from "../types";
import type { AiMessage } from "../types";

/** 4xx from the provider: the same request will fail again, so no retry. */
class NonRetryableProviderError extends Error {}

/**
 * OpenAI-compatible wire format. A tool result is only valid right after the
 * assistant turn that requested it, so that turn carries its tool_calls.
 */
export function toWireMessages(messages: AiMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
    }
    return { role: m.role, content: m.content };
  });
}

export class ExternalAiProvider implements AiProvider {
  readonly key = "external";
  readonly displayName = "external-provider";
  readonly sandbox = false;
  readonly available: boolean;

  constructor() {
    this.available = Boolean(env.aiGatewayApiKey);
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.aiGatewayApiKey}`,
    };
  }

  async complete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
    if (!this.available) {
      throw new Error("ExternalAiProvider is not configured (missing API key)");
    }
    const started = Date.now();

    const body: Record<string, unknown> = {
      model: env.aiGatewayModel,
      messages: toWireMessages(request.messages),
      // Reasoning models (e.g. Atria-Dawn-Preview) spend part of this budget on
      // internal reasoning before the visible answer appears; keep it generous.
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.4,
    };
    if (request.jsonMode) {
      body.response_format = { type: "json_object" };
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }

    let attempt = 0;
    let lastError: Error | undefined;
    const maxRetries = Math.max(0, env.aiGatewayMaxRetries);

    while (attempt <= maxRetries) {
      // A fresh controller per attempt: the deadline must protect every
      // outbound call, including retries after a slow first attempt.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.aiGatewayTimeoutMs);
      try {
        const response = await fetch(`${env.aiGatewayBaseUrl}/chat/completions`, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const text = await safeReadText(response);
          // 4xx is not retryable; 5xx is (spec §50 error handling).
          if (response.status >= 400 && response.status < 500) {
            throw new NonRetryableProviderError(`provider 4xx: ${response.status} ${redactError(text)}`);
          }
          throw new Error(`provider ${response.status} ${redactError(text)}`);
        }

        const json = await response.json();
        const choice = json.choices?.[0];
        const message = choice?.message ?? {};
        const toolCalls = Array.isArray(message.tool_calls)
          ? message.tool_calls.map((tc: any) => ({
              id: String(tc.id ?? ""),
              name: String(tc.function?.name ?? ""),
              arguments:
                typeof tc.function?.arguments === "string"
                  ? safeParseJson(tc.function.arguments)
                  : (tc.function?.arguments ?? {}),
            }))
          : undefined;

        // Reasoning models can spend their whole budget on internal reasoning
        // and return an empty content with finish_reason "length". That is a
        // truncated answer, not a real one: retry once with a larger budget
        // instead of handing the user an empty reply (spec §108, §148).
        const hasContent = typeof message.content === "string" && message.content.trim() !== "";
        if (!hasContent && (!toolCalls || toolCalls.length === 0) && choice?.finish_reason === "length" && attempt === 0) {
          attempt++;
          body.max_tokens = Math.min((body.max_tokens as number) * 4, 16384);
          await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
          continue;
        }

        return {
          content: hasContent ? (message.content as string) : "",
          toolCalls,
          provider: this.key,
          model: json.model ?? env.aiGatewayModel,
          latencyMs: Date.now() - started,
          tokensIn: json.usage?.prompt_tokens,
          tokensOut: json.usage?.completion_tokens,
          sandbox: false,
          finishReason: choice?.finish_reason,
        };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error instanceof NonRetryableProviderError) break;
        attempt++;
        if (attempt <= maxRetries) {
          // Exponential backoff, only for retryable (network/5xx) failures.
          await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
        }
      }
    }
    throw lastError ?? new Error("provider failed without error");
  }

  async embed(request: AiEmbeddingRequest): Promise<AiEmbeddingResponse> {
    if (!this.available) {
      throw new Error("ExternalAiProvider is not configured (missing API key)");
    }
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.aiGatewayTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${env.aiGatewayBaseUrl}/embeddings`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ model: "text-embedding", input: request.texts }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      // Atria-Dawn-Preview has no /embeddings endpoint; the gateway falls back
      // to the deterministic local embedder for the vector layer.
      throw new Error(`embedding provider ${response.status}`);
    }
    const json = await response.json();
    return {
      vectors: (json.data ?? []).map((d: any) => d.embedding as number[]),
      provider: this.key,
      model: "text-embedding",
      sandbox: false,
      latencyMs: Date.now() - started,
    };
  }
}

function safeReadText(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function redactError(text: string): string {
  // Provider error bodies can echo auth details; strip them before logging.
  return text.replace(/[A-Za-z0-9\-_]{20,}/g, "[redacted]").slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
