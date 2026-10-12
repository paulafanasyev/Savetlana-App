/**
 * Автоотмена неоплаченных заказов.
 *
 * Заказ, который не оплачен за 24 часа, отменяется, а зарезервированный при
 * оформлении товар возвращается в продажу (через transitionOrder → CANCELLED,
 * остатки возвращаются ровно один раз).
 *
 * Деньги покупателя важнее порядка: если по заказу есть настоящий платёж в
 * банке, сначала спрашиваем банк. Оплачен — проводим оплату, а не отменяем.
 * Банк ещё ждёт подтверждения — ждём до 72 часов. Банк недоступен — пропускаем
 * до следующего запуска.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { notify } from "./notifications";
import { transitionOrder } from "./orders";
import { applyVerifiedPayment, fetchLivePayment, type LivePayment } from "./payment-webhooks";

export const UNPAID_ORDER_TTL_HOURS = 24;
/** Дольше этого не ждём даже «ожидающий» платёж в банке. */
export const UNPAID_ORDER_HARD_LIMIT_HOURS = 72;

export type ExpiryDecision = "cancel" | "apply_payment" | "wait" | "skip";

/** Чистое решение по одному заказу (без БД и сети) — легко проверить тестами. */
export function decideExpiry(input: {
  ageHours: number;
  payment: { sandbox: boolean; status: string; providerRef: string | null } | null;
  /** Ответ банка: объект, null (банк не настроен) или "error" (банк недоступен). */
  live?: LivePayment | null | "error";
}): ExpiryDecision {
  if (input.ageHours < UNPAID_ORDER_TTL_HOURS) return "skip";
  const p = input.payment;
  if (!p || p.sandbox || !p.providerRef || p.status === "FAILED") return "cancel";
  if (p.status === "SUCCEEDED") return "skip"; // оплата уже записана, заказ доведёт уведомление/сверка
  const live = input.live;
  if (live === "error") return "skip";
  if (live && live.status === "SUCCEEDED") return "apply_payment";
  if (live && live.status === "FAILED") return "cancel";
  return input.ageHours >= UNPAID_ORDER_HARD_LIMIT_HOURS ? "cancel" : "wait";
}

export async function expireUnpaidOrders(options?: { now?: Date; limit?: number }): Promise<{
  checked: number;
  cancelled: number;
  paid: number;
  waiting: number;
  failed: number;
}> {
  const now = options?.now ?? new Date();
  const orders = await prisma.order.findMany({
    where: {
      status: "PAYMENT_PENDING",
      createdAt: { lte: new Date(now.getTime() - UNPAID_ORDER_TTL_HOURS * 3600_000) },
    },
    select: {
      id: true,
      number: true,
      buyerId: true,
      createdAt: true,
      payment: { select: { id: true, provider: true, providerRef: true, status: true, sandbox: true } },
    },
    orderBy: { createdAt: "asc" },
    take: options?.limit ?? 25,
  });

  let cancelled = 0;
  let paid = 0;
  let waiting = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const ageHours = (now.getTime() - order.createdAt.getTime()) / 3600_000;
      const p = order.payment;
      let live: LivePayment | null | "error" | undefined;
      if (p && !p.sandbox && p.providerRef && p.status === "PENDING") {
        live = await fetchLivePayment(p.provider, p.providerRef).catch(() => "error" as const);
      }
      const decision = decideExpiry({ ageHours, payment: p, live });

      if (decision === "apply_payment" && p?.providerRef && live && live !== "error") {
        await applyVerifiedPayment({
          providerKey: p.provider,
          providerRef: p.providerRef,
          orderId: order.id,
          status: live.status,
          rawStatus: live.rawStatus,
          amountKopecks: live.amountKopecks,
        });
        paid += 1;
        continue;
      }
      if (decision === "wait") {
        waiting += 1;
        continue;
      }
      if (decision !== "cancel") continue;

      await transitionOrder({
        orderId: order.id,
        to: "CANCELLED",
        note: `не оплачен за ${UNPAID_ORDER_TTL_HOURS} ч — отменён автоматически`,
        actorId: "system",
        actorRole: "system",
      });
      if (p && p.status === "PENDING") {
        await prisma.payment.update({
          where: { id: p.id },
          data: { status: "FAILED", errorMessage: "Заказ отменён: не оплачен вовремя", processedAt: new Date() },
        });
      }
      await notify({
        userId: order.buyerId,
        kind: "order_status",
        title: `Заказ ${order.number} отменён`,
        body: `Заказ не был оплачен в течение ${UNPAID_ORDER_TTL_HOURS} часов, поэтому мы его отменили и вернули товар в продажу. Если он ещё нужен — оформите заново.`,
        url: `/orders/${order.id}`,
      }).catch(() => undefined);
      await audit({
        actorRole: "system",
        action: "order.expired_unpaid",
        targetType: "Order",
        targetId: order.id,
        after: { ageHours: Math.round(ageHours), payment: p ? { provider: p.provider, status: p.status } : null },
      }).catch(() => undefined);
      cancelled += 1;
    } catch {
      // Один проблемный заказ не должен останавливать порцию.
      failed += 1;
    }
  }

  return { checked: orders.length, cancelled, paid, waiting, failed };
}
