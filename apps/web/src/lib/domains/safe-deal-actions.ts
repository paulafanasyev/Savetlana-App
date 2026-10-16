/**
 * Безопасная сделка для товаров: завершение заказа покупателем и автоприёмка.
 * Только завершённый заказ открывает продавцу выплату (PAYOUT_READY_ORDER_STATUSES).
 */
import { prisma } from "../prisma";
import { transitionOrder } from "./orders";
import { notify } from "./notifications";
import { ACCEPT_DAYS, ordersDueForAutoAccept } from "../safe-deal";
import { UserFacingError } from "./engagement-rules";

async function notifySellerPaid(orderId: string, number: string, auto: boolean): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { sellerProfile: { select: { userId: true } } } });
  const sellerUserId = order?.sellerProfile?.userId;
  if (!sellerUserId) return;
  await notify({
    userId: sellerUserId,
    kind: "order_status",
    title: auto ? `Заказ ${number} принят автоматически` : `Покупатель принял заказ ${number}`,
    body: auto
      ? `Покупатель не открыл возврат или спор за ${ACCEPT_DAYS} дней после доставки. Деньги за заказ доступны к выплате.`
      : "Покупатель подтвердил, что товар получен и всё в порядке. Деньги за заказ доступны к выплате.",
    url: "/seller/payouts",
  }).catch(() => undefined);
}

/** Покупатель нажал «Товар получен, всё в порядке». */
export async function confirmReceipt(orderId: string, buyerId: string): Promise<{ status: string; number: string }> {
  const order = await prisma.order.findFirst({ where: { id: orderId, buyerId }, select: { id: true, status: true } });
  if (!order) throw new UserFacingError("Заказ не найден", 404);
  if (order.status === "COMPLETED") throw new UserFacingError("Заказ уже завершён", 409);
  if (order.status !== "DELIVERED") throw new UserFacingError("Подтвердить получение можно, когда заказ доставлен", 409);
  let moved: Awaited<ReturnType<typeof transitionOrder>>;
  try {
    moved = await transitionOrder({
      orderId,
      to: "COMPLETED",
      note: "покупатель подтвердил получение",
      actorId: buyerId,
      actorRole: "buyer",
      actingUserId: buyerId,
      onlyFrom: ["DELIVERED"],
    });
  } catch {
    throw new UserFacingError("Статус заказа уже изменился, обновите страницу", 409);
  }
  await notifySellerPaid(orderId, moved.order.number, false);
  return { status: moved.order.status, number: moved.order.number };
}

/**
 * Фоновая задача: доставленные заказы без возврата и спора через ACCEPT_DAYS
 * дней завершаются сами. Время считается от последней записи о доставке.
 */
export async function autoAcceptDelivered(input: { limit?: number; now?: Date } = {}): Promise<{ checked: number; completed: number; failed: number }> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const delivered = await prisma.order.findMany({
    where: { status: "DELIVERED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  if (delivered.length === 0) return { checked: 0, completed: 0, failed: 0 };
  const ids = delivered.map((o) => o.id);
  const rows = await prisma.orderHistory.findMany({
    where: { orderId: { in: ids }, toStatus: "DELIVERED" },
    select: { orderId: true, createdAt: true },
  });
  const due = ordersDueForAutoAccept(ids, rows, now).slice(0, limit);
  let completed = 0;
  let failed = 0;
  for (const id of due) {
    try {
      const moved = await transitionOrder({
        orderId: id,
        to: "COMPLETED",
        note: `автоприёмка: покупатель не открыл возврат или спор за ${ACCEPT_DAYS} дней`,
        actorId: "system",
        actorRole: "system",
        onlyFrom: ["DELIVERED"],
      });
      completed += 1;
      const order = await prisma.order.findUnique({ where: { id }, select: { buyerId: true } });
      if (order) {
        await notify({
          userId: order.buyerId,
          kind: "order_status",
          title: `Заказ ${moved.order.number} завершён`,
          body: `Прошло ${ACCEPT_DAYS} дней после доставки, и вы не открыли возврат или спор, поэтому деньги переданы продавцу. Если с товаром проблема, оформите возврат на странице заказа.`,
          url: `/orders/${id}`,
        }).catch(() => undefined);
      }
      await notifySellerPaid(id, moved.order.number, true);
    } catch {
      // Статус мог измениться (покупатель открыл спор): пропускаем.
      failed += 1;
    }
  }
  return { checked: ids.length, completed, failed };
}
