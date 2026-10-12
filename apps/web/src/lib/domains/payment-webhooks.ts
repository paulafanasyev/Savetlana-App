/**
 * Общая обработка подтверждённого банком статуса платежа (ЮKassa, Т-Банк, Сбер, Альфа).
 *
 * Вызывается ТОЛЬКО после того, как статус и сумма получены напрямую из API
 * банка с нашими ключами — телу уведомления не доверяем. Повтор одного и того
 * же события не применяется дважды.
 *
 * Покупатель мог открыть оплату несколько раз (каждая попытка — свой платёж
 * в банке). Если оплачена не последняя попытка, заказ всё равно становится
 * оплаченным по ней; если заказ уже оплачен другой попыткой — это двойная
 * оплата: ничего не меняем и пишем в аудит для возврата.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { markOrderPaid } from "./payments";
import { canTransition } from "./orders";

export type VerifiedStatus = "PENDING" | "SUCCEEDED" | "FAILED";

export async function applyVerifiedPayment(input: {
  providerKey: string;
  providerRef: string;
  /** Заказ, к которому банк привязал платёж (из OrderId/jsonParams/metadata). */
  orderId: string | undefined;
  status: VerifiedStatus;
  rawStatus: string;
  amountKopecks: number | null;
}): Promise<"applied" | "duplicate" | "ignored"> {
  const byRef = await prisma.payment.findFirst({
    where: { provider: input.providerKey, providerRef: input.providerRef },
    select: { orderId: true },
  });
  const orderId = byRef?.orderId ?? input.orderId;
  if (!orderId) return "ignored";

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, totalKopecks: true, payment: { select: { id: true, status: true, providerRef: true, provider: true } } },
  });
  const payment = order?.payment;
  if (!order || !payment || payment.provider !== input.providerKey) return "ignored";

  const eventId = `${input.providerKey}:${input.providerRef}:${input.rawStatus}`.slice(0, 190);
  const seen = await prisma.outboxMessage.findUnique({ where: { id: eventId } }).catch(() => null);
  if (seen) return "duplicate";
  await prisma.outboxMessage.create({
    data: {
      id: eventId,
      aggregate: "payment-webhook",
      aggregateId: order.id,
      type: `${input.providerKey}_${input.rawStatus}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64),
      payload: JSON.stringify({ providerRef: input.providerRef, status: input.rawStatus, amountKopecks: input.amountKopecks }),
    },
  });

  const isCurrent = payment.providerRef === input.providerRef;

  if (input.status === "SUCCEEDED") {
    if (input.amountKopecks !== order.totalKopecks) {
      await audit({
        actorRole: "system",
        action: "payment.webhook.amount_mismatch",
        targetType: "Order",
        targetId: order.id,
        after: { provider: input.providerKey, providerRef: input.providerRef, paid: input.amountKopecks, expected: order.totalKopecks },
      }).catch(() => undefined);
      return "ignored";
    }
    if (!isCurrent && payment.status === "SUCCEEDED") {
      await audit({
        actorRole: "system",
        action: "payment.webhook.double_payment",
        targetType: "Order",
        targetId: order.id,
        after: { provider: input.providerKey, extraProviderRef: input.providerRef, paidProviderRef: payment.providerRef, amountKopecks: input.amountKopecks },
      }).catch(() => undefined);
      return "ignored";
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCEEDED", providerRef: input.providerRef, errorMessage: null, processedAt: new Date() },
    });
    if (canTransition(order.status, "PAID")) {
      await markOrderPaid(order.id, false);
    }
    await audit({
      actorRole: "system",
      action: "payment.webhook.captured",
      targetType: "Order",
      targetId: order.id,
      after: { provider: input.providerKey, providerRef: input.providerRef },
    }).catch(() => undefined);
    return "applied";
  }

  if (input.status === "FAILED" && isCurrent && payment.status !== "SUCCEEDED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", errorMessage: `Платёж отклонён или отменён банком (${input.rawStatus})`, processedAt: new Date() },
    });
  }
  return "applied";
}
