/**
 * SvetlanaModelProvider — the interface the future trained model will plug into
 * (spec §21, §53).
 *
 * STATUS: NOT_PROVEN. The adapter contract exists and is unit-tested, but no
 * trained weights exist yet. It is deliberately *not* registered in the live
 * router until it passes the evaluation suite in `evaluateSvetlanaModel()`.
 *
 * Requirements for the own model (spec §9, §53):
 *   - generate / stream / tool_call / structured_output
 *   - no mutable business facts baked into weights (prices, stock, orders,
 *     laws must come from databases / RAG / APIs)
 *   - must pass: buyer tasks, seller tasks, tool calling, uncertainty,
 *     recovery, privacy, hallucinated-execution, recommendation explanation.
 */
import type {
  AiCompleteRequest,
  AiCompleteResponse,
  AiProvider,
} from "../types";

export interface SvetlanaModelCapabilities {
  generate: boolean;
  stream: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  vision: boolean;
}

export interface SvetlanaEvaluationReport {
  suite: string;
  passed: boolean;
  buyerTasks: number;
  sellerTasks: number;
  toolCalling: number;
  hallucinationResistance: number;
  recommendationExplanation: number;
  privacyCompliance: number;
  notes: string;
}

/**
 * Minimal evaluation gate. The own model is only promoted into the router
 * after this passes — existence of inference is NOT readiness (spec §53).
 */
export function evaluateSvetlanaModel(report: SvetlanaEvaluationReport): {
  promoted: boolean;
  reason: string;
} {
  const min = 0.8;
  const scores = [
    report.buyerTasks,
    report.sellerTasks,
    report.toolCalling,
    report.hallucinationResistance,
    report.recommendationExplanation,
    report.privacyCompliance,
  ];
  if (scores.some((s) => s < min)) {
    return {
      promoted: false,
      reason: `Evaluation suite ${report.suite} below threshold (min ${min})`,
    };
  }
  return { promoted: true, reason: `Evaluation suite ${report.suite} passed` };
}

/**
 * Adapter skeleton. When weights + an inference endpoint exist, fill in the
 * fetch call; nothing else in the platform needs to change.
 */
export class SvetlanaModelProvider implements AiProvider {
  readonly key = "svetlana-own";
  readonly displayName = "Svetlana Model";
  readonly sandbox = false;
  readonly available = false; // no trained model exists yet

  constructor(private inferenceEndpoint?: string) {}

  get capabilities(): SvetlanaModelCapabilities {
    return {
      generate: true,
      stream: true,
      toolCall: true,
      structuredOutput: true,
      vision: false,
    };
  }

  async complete(_request: AiCompleteRequest): Promise<AiCompleteResponse> {
    throw new Error(
      "SvetlanaModelProvider: own model is not trained yet (PENDING). External provider is the active backend."
    );
  }
}
