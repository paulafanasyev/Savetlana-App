/**
 * AI Gateway — the single server-side entry point to any model (spec §2, §7,
 * §8, §52, §88).
 *
 * Responsibilities:
 *   - pick a provider per task class (routing policy)
 *   - fall back through the provider order on failure (spec §88)
 *   - run every outbound payload through the privacy guard (spec §83)
 *   - record observability: latency, provider, tokens, errors (spec §51, §87)
 *
 * The user-facing brand is always Светлана. `provider`/`model` below are
 * internal metadata only and are never surfaced to the UI.
 */
import { env, hasExternalAiCredentials } from "../env";
import { prisma } from "../prisma";
import type {
  AiCompleteRequest,
  AiCompleteResponse,
  AiEmbeddingRequest,
  AiEmbeddingResponse,
  AiProvider,
  AiTaskClass,
} from "./types";
import { ExternalAiProvider } from "./providers/external";
import { MockAiProvider, MockEmbeddingProvider } from "./providers/mock";
import { SvetlanaModelProvider } from "./providers/svetlana";
import { classifyText, logOutboundPayload, redactForModel } from "./privacy";

// --- Provider registry ----------------------------------------------------
// The own model is deliberately NOT registered: it stays NOT_PROVEN until it
// passes the evaluation suite (see providers/svetlana.ts).
const externalProvider = new ExternalAiProvider();
const mockProvider = new MockAiProvider();
const mockEmbedding = new MockEmbeddingProvider();

/**
 * Provider order per task class. When no external key is configured the
 * deterministic sandbox answers everything, and every result it produces is
 * labelled MOCK VERIFIED.
 */
function candidates(taskClass: AiTaskClass): AiProvider[] {
  const order: AiProvider[] = [];
  if (taskClass === "embedding") {
    if (externalProvider.available) order.push(externalProvider);
    order.push(mockEmbedding);
    return order;
  }
  if (hasExternalAiCredentials) order.push(externalProvider);
  order.push(mockProvider);
  return order;
}

export interface GatewayResult {
  response: AiCompleteResponse;
  /** True when a real (non-sandbox) provider produced the answer. */
  live: boolean;
  /** Provider chain actually attempted, for observability. */
  attempted: string[];
}

export class AiGateway {
  async complete(request: AiCompleteRequest): Promise<GatewayResult> {
    const chain = candidates(request.taskClass);
    const attempted: string[] = [];
    let lastError: Error | undefined;

    for (const provider of chain) {
      if (!provider.available) continue;
      attempted.push(provider.key);
      try {
        // Privacy guard runs per outbound call (spec §83).
        const sanitizedMessages = request.messages.map((m) => ({
          ...m,
          content: redactForModel(m.content),
        }));
        const classification = classifyText(
          sanitizedMessages.map((m) => m.content).join("\n")
        );
        const allowed = classification.dataClass !== "SENSITIVE_FINANCIAL" &&
          classification.dataClass !== "SECRET";
        await logOutboundPayload({
          traceId: request.traceId,
          provider: provider.key,
          taskClass: request.taskClass,
          dataClass: classification.dataClass,
          findings: classification.findings,
          allowed,
        });
        if (!allowed) {
          throw new Error(
            "outbound payload blocked by privacy policy (secret/financial data)"
          );
        }

        const response = await provider.complete({
          ...request,
          messages: sanitizedMessages,
        });
        await this.recordObservability(request, provider, response, "success");
        return { response, live: !response.sandbox, attempted };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.recordObservability(
          request,
          provider,
          null,
          "error",
          lastError.message
        );
        // spec §88: continue to the next provider in the chain.
      }
    }

    // spec §89 degraded mode: the platform must not die with the AI.
    throw new Error(
      `AI gateway: all providers failed (${attempted.join(" → ")}). ` +
        `Last error: ${lastError?.message ?? "unknown"}. ` +
        `The marketplace itself remains fully usable.`
    );
  }

  async embed(request: AiEmbeddingRequest): Promise<AiEmbeddingResponse> {
    const chain = candidates("embedding");
    for (const provider of chain) {
      if (!provider.available || !provider.embed) continue;
      try {
        return await provider.embed(request);
      } catch {
        // fall through to next candidate
      }
    }
    return mockEmbedding.embed(request);
  }

  private async recordObservability(
    request: AiCompleteRequest,
    provider: AiProvider,
    response: AiCompleteResponse | null,
    status: "success" | "error",
    errorMessage?: string
  ): Promise<void> {
    try {
      await prisma.aiModelCall.upsert({
        where: { traceId: request.traceId },
        create: {
          traceId: request.traceId,
          taskClass: request.taskClass,
          provider: provider.key,
          model: response?.model ?? provider.displayName,
          status,
          latencyMs: response?.latencyMs ?? 0,
          tokensIn: response?.tokensIn,
          tokensOut: response?.tokensOut,
          errorMessage: errorMessage?.slice(0, 500),
        },
        update: {
          provider: provider.key,
          model: response?.model ?? provider.displayName,
          status,
          latencyMs: response?.latencyMs ?? 0,
          tokensIn: response?.tokensIn,
          tokensOut: response?.tokensOut,
          errorMessage: errorMessage?.slice(0, 500),
        },
      });
    } catch {
      // Observability must never break the request.
    }
  }
}

export const aiGateway = new AiGateway();

/**
 * The honest, single source of truth for "is a real model answering right
 * now?". Surfaced in the UI and in every report.
 */
export function aiMode(): { mode: "LIVE" | "SANDBOX"; provider: string } {
  if (hasExternalAiCredentials) {
    return { mode: "LIVE", provider: env.aiGatewayModel };
  }
  return { mode: "SANDBOX", provider: "sandbox-rule-engine" };
}

/**
 * Stable trace ids so every agent run is correlatable end to end (spec §51).
 */
export function newTraceId(prefix = "tr"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export type { AiTaskClass };
