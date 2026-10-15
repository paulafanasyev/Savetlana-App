/**
 * «Что мне сделать сегодня?»: Светлана отвечает списком дел. Продавцу тем же,
 * что в блоке «Что сделать сегодня» на главной кабинета: споры, заказы,
 * сообщения, остатки и скидки, которые скоро закончатся. Покупателю его
 * заказы, которые ждут действия (тот же список, что на странице «Мои заказы»):
 * оплатить, забрать, проверить и оставить отзыв, споры. Только чтение.
 */
import { sellerTodoItems } from "../../domains/seller-badges";
import { buyerTodoItems } from "../../domains/buyer-todo-data";
import { BUYER_TODAY_EMPTY, todayAnswer } from "../today-command";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";

export const sellerTodayTool: ToolDefinition = {
  name: "seller_today",
  description:
    "Что сделать сегодня. Продавцу: споры, заказы к отправке, непрочитанные сообщения, закончившиеся товары и скидки, которые закончатся в течение суток. Покупателю: заказы, которые нужно оплатить, забрать, проверить после доставки, и споры. Со ссылками.",
  permission: "READ_ORDERS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    if (ctx.sellerProfileId && ctx.role === "seller") {
      const items = await sellerTodoItems(ctx.sellerProfileId, ctx.userId);
      return { ok: true, data: { todo: items }, summary: todayAnswer(items), verification: "VERIFIED" };
    }
    const items = await buyerTodoItems(ctx.userId);
    return { ok: true, data: { todo: items }, summary: todayAnswer(items, BUYER_TODAY_EMPTY), verification: "VERIFIED" };
  },
};
