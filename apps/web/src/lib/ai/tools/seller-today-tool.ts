/**
 * «Что мне сделать сегодня?»: Светлана отвечает списком дел продавца, тем же,
 * что в блоке «Что сделать сегодня» на главной кабинета: споры, заказы,
 * сообщения, остатки и скидки, которые скоро закончатся. Только чтение.
 */
import { sellerTodoItems } from "../../domains/seller-badges";
import { todayAnswer } from "../today-command";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";

export const sellerTodayTool: ToolDefinition = {
  name: "seller_today",
  description: "Что продавцу сделать сегодня: споры, заказы к отправке, непрочитанные сообщения, закончившиеся товары и скидки, которые закончатся в течение суток. Со ссылками на разделы кабинета.",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.sellerProfileId || ctx.role !== "seller") {
      return { ok: false, error: "список дел на сегодня есть в кабинете продавца", verification: "NOT_PROVEN" };
    }
    const items = await sellerTodoItems(ctx.sellerProfileId, ctx.userId);
    return { ok: true, data: { todo: items }, summary: todayAnswer(items), verification: "VERIFIED" };
  },
};
