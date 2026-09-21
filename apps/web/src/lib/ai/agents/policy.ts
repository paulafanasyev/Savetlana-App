/**
 * Agent Policy (spec §45, §147, §148).
 *
 * Decides what the agent MAY do autonomously vs. what it must ask about.
 * Deterministic and auditable — never an LLM judgement call.
 */
import type { RiskLevel } from "../tools/registry";

export interface PolicyDecision {
  /** proceed | needs_user_confirmation | forbidden */
  decision: "proceed" | "needs_user_confirmation" | "forbidden";
  reason: string;
}

const FINANCIAL_OR_HIGHER: RiskLevel[] = ["FINANCIAL", "ACCOUNT_SECURITY", "HIGH_RISK_WRITE"];

/**
 * A write with financial or account-security consequences always requires an
 * explicit, in-session confirmation. The agent may never self-confirm (§147).
 */
export function decide(toolRisk: RiskLevel, confirmed: boolean): PolicyDecision {
  if (toolRisk === "READ") return { decision: "proceed", reason: "read-only" };
  if (FINANCIAL_OR_HIGHER.includes(toolRisk)) {
    return confirmed
      ? { decision: "proceed", reason: "user confirmed the sensitive action" }
      : {
          decision: "needs_user_confirmation",
          reason:
            "это финансовое или чувствительное действие — требуется ваше подтверждение",
        };
  }
  return { decision: "proceed", reason: "low-risk reversible write" };
}

/**
 * Zero-hallucination policy for commerce-critical data (spec §148): when a
 * required value is missing the agent reports NOT_AVAILABLE instead of
 * inventing one.
 */
export function assertKnown<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined || value === "") {
    throw new PolicyAssertionError(field);
  }
  return value;
}

export class PolicyAssertionError extends Error {
  field: string;
  constructor(field: string) {
    super(`NOT_AVAILABLE: значение «${field}» неизвестно — не могу это утверждать`);
    this.field = field;
    this.name = "PolicyAssertionError";
  }
}

/**
 * Agent loop protection (spec §145): bounded steps, bounded tool budget,
 * bounded total latency.
 */
export const AGENT_LIMITS = {
  maxSteps: 8,
  maxToolCalls: 6,
  maxRetriesPerTool: 2,
  stepTimeoutMs: 45_000,
} as const;
