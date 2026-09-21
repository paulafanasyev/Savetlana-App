/**
 * AI Provider Abstraction (spec §2, §7, §21, §53).
 *
 * The user always talks to Светлана. Which model actually answers is decided
 * here, behind the gateway. Adding the future trained Svetlana model means
 * writing one more AiProvider adapter — no frontend or business logic changes.
 */

export type AiRole = "system" | "user" | "assistant" | "tool";

export interface AiMessage {
  role: AiRole;
  content: string;
  toolCallId?: string;
  toolCalls?: AiToolCallRequest[];
}

export interface AiToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface AiCompleteRequest {
  /** Task class drives routing (spec §52): simple/vision/reasoning/ranking. */
  taskClass: AiTaskClass;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  /** When true the provider must answer strictly as JSON. */
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Caller-provided correlation id for observability. */
  traceId: string;
}

export type AiTaskClass =
  | "classification"
  | "search_intent"
  | "reasoning"
  | "vision"
  | "embedding"
  | "ranking"
  | "safety"
  | "conversation";

export interface AiCompleteResponse {
  content: string;
  toolCalls?: AiToolCallRequest[];
  provider: string;
  model: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  /** MOCK means a deterministic sandbox produced this, not a real model. */
  sandbox: boolean;
  finishReason?: string;
}

export interface AiEmbeddingRequest {
  texts: string[];
  traceId: string;
}

export interface AiEmbeddingResponse {
  vectors: number[][];
  provider: string;
  model: string;
  sandbox: boolean;
  latencyMs: number;
}

/**
 * The single interface every provider implements — external today, the future
 * Svetlana model, and the deterministic mock used when no key is configured.
 */
export interface AiProvider {
  readonly key: string;
  readonly displayName: string;
  /** True when real credentials/access exist for this provider. */
  readonly available: boolean;
  readonly sandbox: boolean;
  complete(request: AiCompleteRequest): Promise<AiCompleteResponse>;
  embed?(request: AiEmbeddingRequest): Promise<AiEmbeddingResponse>;
}

/**
 * Routing policy (spec §52): simple tasks never burn the most expensive model.
 */
export const TASK_CLASS_MODEL: Record<AiTaskClass, "light" | "strong" | "vision" | "embedding"> = {
  classification: "light",
  search_intent: "light",
  conversation: "strong",
  reasoning: "strong",
  vision: "vision",
  embedding: "embedding",
  ranking: "embedding",
  safety: "light",
};

export interface ProviderRouter {
  pick(taskClass: AiTaskClass): AiProvider;
}
