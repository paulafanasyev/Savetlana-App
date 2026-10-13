/**
 * Background job engine (P0-18, spec §50/§78).
 *
 * The platform has several classes of deferred work that must not run inline
 * with a user request:
 *
 *   1. Outbox side effects (payouts) — the DB transaction must not hold open
 *      while a bank HTTP call completes (P0-8).
 *   2. Periodic sweeps — stale availability, expired documents, dead-letter
 *      cleanup.
 *   3. Carrier tracking sync for in-flight shipments.
 *   4. Сверка зависших платежей — если уведомление банка потерялось.
 *   5. Автоотмена заказов, не оплаченных за 24 часа (товар возвращается в продажу).
 *   6. Конец акций по сроку — обычная цена возвращается сама.
 *   7. Предупреждения продавцу, что товар заканчивается.
 *
 * This module exposes a single `runJobs()` entry point that performs one
 * bounded slice of every category, so it can be driven by Vercel Cron
 * (`/api/cron/jobs`) or by any worker with a DB connection. Each category is
 * isolated: a failure in one never prevents the others from running.
 *
 * Honesty: this is a poll-based worker, not a queue. It is correct and
 * idempotent (claims are atomic), and it is the right starting architecture —
 * but at very high throughput it should be replaced by a real queue
 * (Redis/Upstash) behind the same `runJobs` contract.
 */
import { prisma } from "../prisma";
import { processPayoutOutbox } from "./payments";
import { reconcilePendingPayments } from "./payment-webhooks";
import { expireUnpaidOrders } from "./order-expiry";
import { sweepStaleAvailability } from "./inventory";
import { sweepExpiredDocuments } from "./documents";
import { syncTracking } from "./delivery";
import { checkSlaBreaches } from "./disputes";
import { expirePromotions } from "./seller-promotions";
import { sendLowStockAlerts } from "./stock-alerts";
import { retryFailedDeliveries } from "../notification-delivery";
import { ShipmentStatus_VALUES } from "../db/enums";

export interface JobRunResult {
  startedAt: string;
  finishedAt: string;
  categories: Record<string, { ok: boolean; detail: string; durationMs: number }>;
}

async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  describe: (r: T) => string,
): Promise<[string, { ok: boolean; detail: string; durationMs: number }]> {
  const start = Date.now();
  try {
    const r = await fn();
    return [name, { ok: true, detail: describe(r), durationMs: Date.now() - start }];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return [name, { ok: false, detail: message, durationMs: Date.now() - start }];
  }
}

/**
 * Processes one bounded slice of every background category. Safe to call
 * concurrently from multiple workers: each category claims its rows atomically.
 */
export async function runJobs(): Promise<JobRunResult> {
  const startedAt = new Date();

  // Сначала сверка оплат и только потом автоотмена: оплаченный заказ не
  // должен успеть отмениться раньше, чем пройдёт его оплата.
  const reconcile = await timed("payment_reconcile", () => reconcilePendingPayments({ limit: 20 }), (r) =>
    `${r.checked} checked, ${r.updated} updated, ${r.failed} failed`);
  const expiry = await timed("unpaid_orders_expiry", () => expireUnpaidOrders({ limit: 25 }), (r) =>
    `${r.checked} checked, ${r.cancelled} cancelled, ${r.paid} paid, ${r.waiting} waiting, ${r.failed} failed`);

  const entries = await Promise.all([
    timed("payout_outbox", () => processPayoutOutbox({ limit: 25 }), (r) =>
      `${r.processed} processed, ${r.succeeded} succeeded, ${r.failed} failed`),
    timed("stale_availability", () => sweepStaleAvailability(), (r) =>
      `${r.hidden.length} hidden, ${r.unknown.length} unconfirmed, ${r.warned.length} warned`),
    timed("expired_documents", () => sweepExpiredDocuments(), (n) => `${n} expired`),
    timed("tracking_sync", () => syncInFlightTracking(), (r) =>
      `${r.synced} synced, ${r.failed} failed`),
    timed("outbox_deadletter", () => sweepDeadLetters(), (n) => `${n} dead-lettered`),
    timed("dispute_sla", () => checkSlaBreaches(), (n) => `${n} breached`),
    timed("delivery_retry", () => retryFailedDeliveries(), (n) => `${n} retried`),
    timed("promo_expiry", () => expirePromotions(), (n) => `${n} promotions ended`),
    timed("low_stock_alerts", () => sendLowStockAlerts(), (n) => `${n} alerts sent`),
  ]);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    categories: Object.fromEntries([reconcile, expiry, ...entries]),
  };
}

/**
 * Polls carrier tracking for shipments that are still in transit. Only
 * shipments with a real carrier and tracking number are polled — a sandbox or
 * seller-declared shipment has no live source to ask (spec §49: never
 * fabricate tracking).
 */
export async function syncInFlightTracking(): Promise<{ synced: number; failed: number }> {
  const inFlight = await prisma.deliveryShipment.findMany({
    where: {
      status: { in: [ShipmentStatus_VALUES[0] as string, ShipmentStatus_VALUES[1] as string, ShipmentStatus_VALUES[2] as string] },
      trackingNumber: { not: null },
    },
    select: { id: true },
    take: 25,
  });

  let synced = 0;
  let failed = 0;
  for (const s of inFlight) {
    try {
      await syncTracking(s.id);
      synced += 1;
    } catch {
      // A single carrier failure must not abort the slice.
      failed += 1;
    }
  }
  return { synced, failed };
}

/** Marks rows that exhausted their retries as DEAD so they stop being polled. */
export async function sweepDeadLetters(): Promise<number> {
  const dead = await prisma.outboxMessage.updateMany({
    where: {
      status: "IN_FLIGHT",
      attempts: { gte: 5 },
    },
    data: { status: "DEAD" },
  });
  return dead.count;
}

/**
 * Job categories exposed for observability/admin (spec §92 "AI monitoring" and
 * the operational tooling list). Describes what each job does and its current
 * backlog so an operator can see the queue is being worked.
 */
export async function jobBacklog(): Promise<Record<string, number>> {
  const [payoutPending, inFlightShipments, deadLetters, paymentsPending] = await Promise.all([
    prisma.outboxMessage.count({
      where: { aggregate: "payout", status: { in: ["PENDING", "IN_FLIGHT"] } },
    }),
    prisma.deliveryShipment.count({
      where: {
        status: { in: [ShipmentStatus_VALUES[0] as string, ShipmentStatus_VALUES[1] as string, ShipmentStatus_VALUES[2] as string] },
        trackingNumber: { not: null },
      },
    }),
    prisma.outboxMessage.count({ where: { status: "DEAD" } }),
    prisma.payment.count({ where: { status: "PENDING", sandbox: false } }),
  ]);

  return {
    payoutOutboxPending: payoutPending,
    shipmentsAwaitingTrackingSync: inFlightShipments,
    deadLetters: deadLetters,
    paymentsAwaitingBankConfirmation: paymentsPending,
  };
}
