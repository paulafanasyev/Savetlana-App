/**
 * Дела покупателя по заказам: один и тот же список для Светланы
 * («что мне сделать сегодня?»), блока «Что сделать сегодня» и значка в шапке.
 */
import { prisma } from "../prisma";
import { BUYER_TODO_STATUSES, buyerTodo, fullyReviewedOrders, type BuyerTodoItem } from "../buyer-todo";

/**
 * Сколько заказов смотрим. Ждущих оплаты, выдачи, в пути и со спорами у
 * покупателя обычно единицы, поэтому запас большой. Доставленные берём с
 * составом заказа (для проверки отзывов), их поменьше.
 */
const ACTIVE_ORDERS_MAX = 500;
const DELIVERED_ORDERS_MAX = 100;

export async function buyerTodoItems(buyerId: string): Promise<BuyerTodoItem[]> {
  const activeStatuses = BUYER_TODO_STATUSES.filter((s) => s !== "DELIVERED");
  const [active, delivered] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId, status: { in: activeStatuses } },
      orderBy: { createdAt: "desc" },
      take: ACTIVE_ORDERS_MAX,
      select: { id: true, number: true, status: true },
    }),
    prisma.order.findMany({
      where: { buyerId, status: "DELIVERED" },
      orderBy: { createdAt: "desc" },
      take: DELIVERED_ORDERS_MAX,
      select: { id: true, number: true, status: true, items: { select: { productId: true } } },
    }),
  ]);
  // Про отзыв не напоминаем, если покупатель уже написал его на все товары заказа.
  const reviews = delivered.length
    ? await prisma.review.findMany({
        where: { authorId: buyerId, orderId: { in: delivered.map((o) => o.id) } },
        select: { orderId: true, productId: true },
      })
    : [];
  return buyerTodo([...active, ...delivered], fullyReviewedOrders(delivered, reviews));
}
