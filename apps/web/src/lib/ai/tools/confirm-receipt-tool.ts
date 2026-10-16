/**
 * Светлана принимает заказ за покупателя: то же, что кнопка «Товар получен,
 * всё в порядке». Деньги безопасной сделки становятся доступны продавцу, поэтому
 * нужно подтверждение. Принять можно только доставленный заказ; если таких
 * несколько, Светлана просит номер, а не угадывает.
 */
import { prisma } from "../../prisma";
import { confirmReceipt } from "../../domains/safe-deal-actions";
import { UserFacingError } from "../../domains/engagement-rules";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";

async function pickOrder(ctx: ToolContext, args: Record<string, unknown>): Promise<{ ok: true; id: string; number: string } | { ok: false; error: string }> {
  const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
  const number = typeof args.number === "string" ? args.number.trim() : "";
  const delivered = await prisma.order.findMany({
    where: { buyerId: ctx.userId, status: "DELIVERED", ...(orderId ? { id: orderId } : number ? { number } : {}) },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, number: true },
  });
  const [first] = delivered;
  if (!first) {
    return {
      ok: false,
      error: orderId || number
        ? "этот заказ не ждёт подтверждения: принять можно только доставленный заказ"
        : "сейчас нет доставленных заказов, которые ждут вашего подтверждения",
    };
  }
  if (delivered.length > 1) {
    return { ok: false, error: `доставлено несколько заказов: ${delivered.map((o) => o.number).join(", ")}. Напишите номер заказа, который хотите принять` };
  }
  return { ok: true, id: first.id, number: first.number };
}

export const confirmReceiptTool: ToolDefinition = {
  name: "confirm_receipt",
  description: "Безопасная сделка: покупатель подтверждает, что доставленный заказ получен и всё в порядке. После этого деньги становятся доступны продавцу. Если доставлено несколько заказов, нужен номер (number). Требует подтверждения.",
  permission: "CONFIRM_RECEIPT",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({ orderId: { type: "string" }, number: { type: "string", description: "номер заказа" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const pick = await pickOrder(ctx, args);
    if (!pick.ok) return { ok: false, error: pick.error, verification: "NOT_PROVEN" };
    try {
      await confirmReceipt(pick.id, ctx.userId);
      return {
        ok: true,
        data: { orderId: pick.id, number: pick.number, status: "COMPLETED" },
        summary: `Готово: заказ ${pick.number} принят, деньги переданы продавцу. Если позже найдёте проблему с товаром, оформите возврат на странице заказа.`,
        verification: "VERIFIED",
      };
    } catch (e) {
      const message = e instanceof UserFacingError ? e.message.charAt(0).toLowerCase() + e.message.slice(1) : "не удалось подтвердить получение";
      return { ok: false, error: message, verification: "NOT_PROVEN" };
    }
  },
};
