/**
 * Общая обработка подтверждённого банком статуса платежа (ЮKassa, Т-Банк, Сбер, Альфа) и сверка зависших платежей.
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
import { YooKassaPaymentProvider, mapYooStatus, valueToKopecks } from "./yookassa";
import { TbankPaymentProvider, mapTbankStatus } from "./tbank";
import { RbsPaymentProvider, mapRbsStatus } from "./rbs";

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

  // Одно событие (платёж + статус) применяется ровно один раз. Ключ включает
  // providerRef: у заказа может быть несколько попыток оплаты с одним статусом.
  const eventId = `${input.providerKey}:${input.providerRef}:${input.rawStatus}`.slice(0, 190);
  const seen = await prisma.outboxMessage.findUnique({ where: { id: eventId } }).catch(() => null);
  if (seen) return "duplicate";
  try {
    await prisma.outboxMessage.create({
      data: {
        id: eventId,
        aggregate: "payment-webhook",
        aggregateId: order.id,
        type: `${input.providerKey}_${input.rawStatus}_${input.providerRef}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120),
        payload: JSON.stringify({ providerRef: input.providerRef, status: input.rawStatus, amountKopecks: input.amountKopecks }),
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });
  } catch {
    // Параллельное уведомление уже записало это событие.
    return "duplicate";
  }

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

// =============================================================================
// Сверка зависших платежей
// =============================================================================
// Уведомление банка может потеряться (сайт был недоступен, банк исчерпал
// повторы). Тогда покупатель заплатил, а заказ висит «ждёт оплаты». Фоновая
// задача раз в несколько минут сама спрашивает банк о таких платежах.

export interface LivePayment {
  status: VerifiedStatus;
  rawStatus: string;
  amountKopecks: number | null;
  orderId: string | undefined;
}

type LiveProviders = {
  yookassa?: YooKassaPaymentProvider;
  tbank?: TbankPaymentProvider;
  sber?: RbsPaymentProvider;
  alfa?: RbsPaymentProvider;
};

function defaultLiveProviders(): LiveProviders {
  return {
    yookassa: new YooKassaPaymentProvider(),
    tbank: new TbankPaymentProvider(),
    sber: new RbsPaymentProvider("sber"),
    alfa: new RbsPaymentProvider("alfa"),
  };
}

/** Статус платежа напрямую из API банка. null — банк не настроен или неизвестен. */
export async function fetchLivePayment(
  providerKey: string,
  providerRef: string,
  providers: LiveProviders = defaultLiveProviders(),
): Promise<LivePayment | null> {
  if (providerKey === "yookassa") {
    const p = providers.yookassa;
    if (!p?.available) return null;
    const live = await p.getPayment(providerRef);
    const amount = live.amount && (live.amount.currency ?? "RUB") === "RUB" ? valueToKopecks(live.amount.value) : NaN;
    return {
      status: mapYooStatus(live.status),
      rawStatus: live.status,
      amountKopecks: Number.isFinite(amount) ? amount : null,
      orderId: live.metadata?.order_id,
    };
  }
  if (providerKey === "tbank") {
    const p = providers.tbank;
    if (!p?.available) return null;
    const live = await p.getPayment(providerRef);
    return { status: mapTbankStatus(live.status), rawStatus: live.status || "UNKNOWN", amountKopecks: live.amountKopecks, orderId: live.orderId };
  }
  if (providerKey === "sber" || providerKey === "alfa") {
    const p = providers[providerKey];
    if (!p?.available) return null;
    const live = await p.getPayment(providerRef);
    return {
      status: mapRbsStatus(live.orderStatus),
      rawStatus: `status_${live.orderStatus ?? "unknown"}`,
      amountKopecks: live.amountKopecks,
      orderId: live.orderId,
    };
  }
  return null;
}

/**
 * Одна порция сверки: платежи в статусе PENDING старше 2 минут и моложе 3 дней.
 * Изменение применяется той же проверкой, что и уведомление банка.
 */
export async function reconcilePendingPayments(options?: { limit?: number; now?: Date }): Promise<{ checked: number; updated: number; failed: number }> {
  const now = options?.now ?? new Date();
  const rows = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      sandbox: false,
      provider: { in: ["yookassa", "tbank", "sber", "alfa"] },
      providerRef: { not: null },
      processedAt: { lte: new Date(now.getTime() - 2 * 60_000), gte: new Date(now.getTime() - 3 * 24 * 3600_000) },
    },
    select: { provider: true, providerRef: true, orderId: true },
    orderBy: { processedAt: "asc" },
    take: options?.limit ?? 20,
  });

  let updated = 0;
  let failed = 0;
  const providers = defaultLiveProviders();
  for (const row of rows) {
    if (!row.providerRef) continue;
    try {
      const live = await fetchLivePayment(row.provider, row.providerRef, providers);
      if (!live || live.status === "PENDING") continue;
      const r = await applyVerifiedPayment({
        providerKey: row.provider,
        providerRef: row.providerRef,
        orderId: live.orderId ?? row.orderId,
        status: live.status,
        rawStatus: live.rawStatus,
        amountKopecks: live.amountKopecks,
      });
      if (r === "applied") updated += 1;
    } catch {
      // Один недоступный банк не должен останавливать всю порцию.
      failed += 1;
    }
  }
  return { checked: rows.length, updated, failed };
}
