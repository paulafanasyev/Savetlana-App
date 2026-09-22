/**
 * Risk tool (spec §27, §33, §40).
 *
 * The risk agent evaluates an order through the deterministic rules engine and
 * reports the *explainable* verdict. It never freezes funds itself: the tool
 * is READ-only, so an AI can never trigger a financial hold without the
 * policy/legal mechanism that governs it (spec §27).
 */
import { evaluateOrderRisk } from "../../domains/risk";
import type { ToolDefinition, ToolResult, ToolContext } from "./registry";
import { looseObjectSchema } from "./registry";

function ok(data: unknown, summary: string): ToolResult {
  return { ok: true, data, summary, verification: "VERIFIED" };
}
function denied(reason: string): ToolResult {
  return { ok: false, error: reason, verification: "NOT_PROVEN" };
}

export const assessOrderRiskTool: ToolDefinition = {
  name: "assess_order_risk",
  description:
    "Оценить риск заказа через детерминированный rules engine. Возвращает уровень, сработавшие правила и объяснение. Не замораживает средства.",
  permission: "READ_RISK",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ orderGroupId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.orderGroupId !== "string" || !args.orderGroupId) {
      return denied("не указан orderGroupId");
    }
    const verdict = await evaluateOrderRisk(args.orderGroupId);
    return ok(
      {
        level: verdict.level,
        ruleId: verdict.ruleId,
        description: verdict.description,
        explanation: verdict.explanation,
        recommendedAction: verdict.recommendedAction,
        signals: verdict.signals,
      },
      `Риск заказа: ${verdict.level}. ${verdict.explanation}`
    );
  },
};
