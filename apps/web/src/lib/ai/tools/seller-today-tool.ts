/**
 * «Что мне сделать сегодня?»: Светлана отвечает списком дел. Продавцу тем же,
 * что в блоке «Что сделать сегодня» на главной кабинета: споры, заказы,
 * сообщения, остатки и скидки, которые скоро закончатся. Покупателю его
 * заказы, которые ждут действия: оплатить, забрать, проверить и оставить
 * отзыв, споры. Только чтение.
 */
import { prisma } from "../../prisma";
import { sellerTodoItems } from "../../domains/seller-badges";
import { BUYER_TODO_STATUSES, buyerTodo, fullyReviewedOrders } from "../../buyer-todo";
import { BUYER_TODAY_EMPTY, todayAnswer } from "../today-command";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";

/** Сколько заказов смотрим: дела по старым заказам всё равно видны в «Моих заказах». */
const BUYER_ORDERS_MAX = 50;

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
    const orders = await prisma.order.findMany({
      where: { buyerId: ctx.userId, status: { in: [...BUYER_TODO_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: BUYER_ORDERS_MAX,
      select: { id: true, number: true, status: true, items: { select: { productId: true } } },
    });
    // Про отзыв не напоминаем, если покупатель уже написал его на все товары заказа.
    const delivered = orders.filter((o) => o.status === "DELIVERED");
    const reviews = delivered.length
      ? await prisma.review.findMany({
          where: { authorId: ctx.userId, orderId: { in: delivered.map((o) => o.id) } },
          select: { orderId: true, productId: true },
        })
      : [];
    const items = buyerTodo(orders, fullyReviewedOrders(delivered, reviews));
    return { ok: true, data: { todo: items }, summary: todayAnswer(items, BUYER_TODAY_EMPTY), verification: "VERIFIED" };
  },
};
