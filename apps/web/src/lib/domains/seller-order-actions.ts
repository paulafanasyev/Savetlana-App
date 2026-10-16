/**
 * Действия продавца с заказом: отказ от оплаченного заказа и обработка
 * возврата. Деньги покупателю возвращаются через тот же банк, а расчёт с
 * продавцом уменьшается на сумму возврата (processRefund).
 */
import { prisma } from "../prisma";
import { transitionOrder, type OrderState } from "./orders";
import { processRefund } from "./payments";
import { notify } from "./notifications";
import { SELLER_ORDER_ACTIONS, actionReason, type SellerOrderAction } from "./order-rules";
import { UserFacingError } from "./engagement-rules";
import { ACCEPT_DAYS } from "../safe-deal";

/**
 * Возвращает покупателю всю ещё не возвращённую сумму оплаты. Повторный вызов
 * не создаёт второй возврат.
 */
export async function refundOrderPayment(input: { orderId: string; reason: string; actorId: string; actorRole: string }): Promise<{ refunded: boolean; status: string | null }> {
  const payment = await prisma.payment.findFirst({
    where: { orderId: input.orderId, status: "SUCCEEDED" },
    select: { id: true, amountKopecks: true },
  });
  if (!payment) return { refunded: false, status: null };
  const refund = await prisma.$transaction(async (tx) => {
    const active = await tx.refund.findFirst({
      where: { orderId: input.orderId, paymentId: payment.id, status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] } },
      orderBy: { createdAt: "asc" },
    });
    if (active) return active;
    const summed = await tx.refund.aggregate({
      where: { orderId: input.orderId, paymentId: payment.id, status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] } },
      _sum: { amountKopecks: true },
    });
    const remaining = payment.amountKopecks - (summed._sum.amountKopecks ?? 0);
    if (remaining <= 0) return null;
    return tx.refund.create({
      data: { paymentId: payment.id, orderId: input.orderId, amountKopecks: remaining, reason: input.reason.slice(0, 200) },
    });
  });
  if (!refund) return { refunded: true, status: "SUCCEEDED" };
  if (refund.status !== "PENDING") return { refunded: true, status: refund.status };
  try {
    const result = await processRefund({ refundId: refund.id, actorId: input.actorId, actorRole: input.actorRole });
    return { refunded: result.status === "SUCCEEDED", status: result.status };
  } catch (error) {
    console.error("[seller-order] refund processing failed", error);
    return { refunded: false, status: "FAILED" };
  }
}

const BUYER_TEXT: Record<SellerOrderAction, (number: string, reason: string) => { title: string; body: string }> = {
  reject: (n, r) => ({ title: `Продавец отменил заказ ${n}`, body: `Причина: ${r}. Деньги возвращаются на карту, обычно это занимает до 3 рабочих дней.` }),
  accept_return: (n) => ({ title: `Продавец принял возврат по заказу ${n}`, body: "Отправьте товар продавцу. Как только он получит посылку, деньги вернутся." }),
  decline_return: (n, r) => ({ title: `Продавец отказал в возврате по заказу ${n}`, body: `Ответ продавца: ${r}. Деньги пока у площадки. Если вы не согласны, откройте спор на странице заказа в течение ${ACCEPT_DAYS} дней: решение примет площадка. Иначе деньги уйдут продавцу.` }),
  refund_return: (n) => ({ title: `Возврат по заказу ${n} оформлен`, body: "Продавец получил товар. Деньги возвращаются на карту, обычно это занимает до 3 рабочих дней." }),
};

export async function performSellerOrderAction(input: {
  orderId: string;
  sellerId: string;
  actorId: string;
  action: SellerOrderAction;
  reason?: unknown;
  comment?: unknown;
}): Promise<{ status: string; refundStatus: string | null }> {
  const rule = SELLER_ORDER_ACTIONS[input.action];
  const reason = actionReason(input.action, input.reason, input.comment);
  if (!reason.ok) throw new UserFacingError(reason.error, 400);

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, sellerId: input.sellerId },
    select: { id: true, number: true, buyerId: true, status: true },
  });
  if (!order) throw new UserFacingError("Заказ не найден среди ваших заказов", 404);
  if (order.status !== rule.from) throw new UserFacingError("Статус заказа уже изменился, обновите страницу", 409);

  let moved: Awaited<ReturnType<typeof transitionOrder>>;
  try {
    moved = await transitionOrder({
      orderId: order.id,
      to: rule.to as OrderState,
      note: `${rule.label}${reason.text ? `: ${reason.text}` : ""}`,
      actorId: input.actorId,
      actorRole: "seller",
      actingSellerId: input.sellerId,
      onlyFrom: [rule.from as OrderState],
    });
  } catch {
    throw new UserFacingError("Статус заказа уже изменился, обновите страницу", 409);
  }
  if (!moved.ok) throw new UserFacingError("Статус заказа уже изменился, обновите страницу", 409);

  let refundStatus: string | null = null;
  if (input.action === "reject" || input.action === "refund_return") {
    const refund = await refundOrderPayment({ orderId: order.id, reason: input.action === "reject" ? "SELLER_CANCELLED" : "RETURN_RECEIVED", actorId: input.actorId, actorRole: "seller" });
    refundStatus = refund.status;
  }

  const text = BUYER_TEXT[input.action](order.number, reason.text);
  await notify({ userId: order.buyerId, kind: "order_status", title: text.title, body: text.body, url: `/orders/${order.id}` });
  return { status: rule.to, refundStatus };
}
