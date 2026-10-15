/**
 * Дела покупателя по заказам: один и тот же список для Светланы
 * («что мне сделать сегодня?») и для блока на странице «Мои заказы».
 */
import { prisma } from "../prisma";
import { BUYER_TODO_STATUSES, buyerTodo, fullyReviewedOrders, type BuyerTodoItem } from "../buyer-todo";

/** Сколько заказов смотрим: дела по старым заказам всё равно видны в «Моих заказах». */
const BUYER_ORDERS_MAX = 50;

export async function buyerTodoItems(buyerId: string): Promise<BuyerTodoItem[]> {
  const orders = await prisma.order.findMany({
    where: { buyerId, status: { in: [...BUYER_TODO_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take: BUYER_ORDERS_MAX,
    select: { id: true, number: true, status: true, items: { select: { productId: true } } },
  });
  // Про отзыв не напоминаем, если покупатель уже написал его на все товары заказа.
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  const reviews = delivered.length
    ? await prisma.review.findMany({
        where: { authorId: buyerId, orderId: { in: delivered.map((o) => o.id) } },
        select: { orderId: true, productId: true },
      })
    : [];
  return buyerTodo(orders, fullyReviewedOrders(delivered, reviews));
}
