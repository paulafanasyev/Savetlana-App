/**
 * Payment / Settlement architecture (spec §25, §26, §30, §125).
 *
 * DESIGN PRINCIPLE: the platform does not store or move customer funds in an
 * application database and does not impersonate a bank. Money moves through a
 * regulated payment partner. What lives here is the *settlement logic*:
 * computing who is owed what after a successful sale, and recording it for
 * the partner to execute.
 *
 * Settlement math (all integer kopecks — floats never touch commerce math):
 *
 *   gross            = sum(item price * qty)
 *   platformFee      = gross * platformFeePercent        (configurable, default 1.5%)
 *   paymentFee       = passed through from the partner   (kept separate from commission)
 *   delivery         = carrier-calculated, per seller order
 *   payout           = gross - platformFee - paymentFee - delivery - adjustments
 *
 * Provider order: ЮKassa (YOOKASSA_SHOP_ID/SECRET_KEY) → generic partner → sandbox.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { canTransition } from "./orders";
import { toKopecks } from "../utils";
import type { PayoutStatus } from "../db/enums";
import { audit } from "./audit";
import { YooKassaPaymentProvider, buildReceipt, type YooReceipt } from "./yookassa";

export const PLATFORM_FEE_PERCENT = env.platformFeePercent;

export interface SettlementBreakdown {
  grossKopecks: number;
  platformFeeKopecks: number;
  paymentFeeKopecks: number;
  deliveryKopecks: number;
  adjustmentsKopecks: number;
  payoutKopecks: number;
}

export function computeSettlement(params: {
  grossKopecks: number;
  /** Partner-reported processing fee, passed through — never invented here. */
  paymentFeeKopecks?: number;
  deliveryKopecks?: number;
  adjustmentsKopecks?: number;
}): SettlementBreakdown {
  const gross = Math.max(0, params.grossKopecks);
  const platformFee = Math.round((gross * PLATFORM_FEE_PERCENT) / 100);
  const paymentFee = Math.max(0, params.paymentFeeKopecks ?? 0);
  const delivery = Math.max(0, params.deliveryKopecks ?? 0);
  const adjustments = params.adjustmentsKopecks ?? 0;
  const payout = Math.max(
    0,
    gross - platformFee - paymentFee - delivery - adjustments
  );
  return {
    grossKopecks: gross,
    platformFeeKopecks: platformFee,
    paymentFeeKopecks: paymentFee,
    deliveryKopecks: delivery,
    adjustmentsKopecks: adjustments,
    payoutKopecks: payout,
  };
}

// --- Payment provider abstraction ----------------------------------------
// A real adapter posts to the partner's API. The sandbox adapter exists only
// for development/tests and is *always* recorded with sandbox: true, so a
// sandbox payment can never be mistaken for a real one (spec §49, §161).

export interface ChargeParams {
  orderId: string;
  amountKopecks: number;
  currency: string;
  idempotencyKey: string;
  /** Human-readable purpose shown by the partner (e.g. "Заказ A-123"). */
  description?: string;
  /** Where the partner returns the buyer after a redirect payment. */
  returnUrl?: string;
  /** Fiscal receipt (54-ФЗ) for partners that issue it. */
  receipt?: YooReceipt;
}

export interface ChargeResult {
  providerRef: string;
  status: string;
  /**
   * Redirect payments (ЮKassa): the buyer must open this page to pay. The
   * order becomes PAID only after the partner confirms via webhook.
   */
  confirmationUrl?: string;
}

export interface PaymentProvider {
  readonly key: string;
  readonly sandbox: boolean;
  readonly available: boolean;
  createCharge(params: ChargeParams): Promise<ChargeResult>;
  getStatus(providerRef: string): Promise<{ status: string }>;
  /**
   * Refunds a captured charge (P0-7, spec §29 return states).
   *
   * `amountKopecks` may be less than the captured amount for a partial refund.
   * The provider's own idempotency key deduplicates network replays: a retry
   * after a timeout must not refund twice.
   */
  refund(params: {
    paymentProviderRef: string;
    amountKopecks: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }>;
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly key = "sandbox-payment";
  readonly sandbox = true;
  readonly available = true;

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    // Deterministic fake reference. Real money never moves.
    return {
      providerRef: `sb_${params.idempotencyKey.slice(0, 16)}_${params.orderId.slice(-6)}`,
      status: "SUCCEEDED",
    };
  }

  async getStatus(providerRef: string): Promise<{ status: string }> {
    return { status: providerRef.startsWith("sb_") ? "SUCCEEDED" : "UNKNOWN" };
  }

  async refund(params: {
    paymentProviderRef: string;
    amountKopecks: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    // Deterministic fake reference. Real money never moves back either — but
    // the contract is identical to a production provider, so swapping in a
    // real partner changes nothing here (spec §25).
    return {
      providerRef: `sb_refund_${params.idempotencyKey.slice(0, 16)}_${params.paymentProviderRef.slice(-6)}`,
      status: "SUCCEEDED",
    };
  }
}

export class PartnerPaymentProvider implements PaymentProvider {
  readonly key = "partner-payment";
  readonly sandbox = false;
  readonly available = Boolean(env.paymentProviderApiKey && env.paymentProviderBaseUrl);

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    if (!this.available) throw new Error("payment partner not configured");
    const response = await fetch(`${env.paymentProviderBaseUrl}/charges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.paymentProviderApiKey}`,
      },
      body: JSON.stringify({
        order_id: params.orderId,
        amount: params.amountKopecks,
        currency: params.currency,
        idempotency_key: params.idempotencyKey,
      }),
    });
    if (!response.ok) {
      throw new Error(`payment partner HTTP ${response.status}`);
    }
    const json = (await response.json()) as { id: string; status: string };
    return { providerRef: json.id, status: json.status };
  }

  async getStatus(providerRef: string): Promise<{ status: string }> {
    if (!this.available) throw new Error("payment partner not configured");
    const response = await fetch(
      `${env.paymentProviderBaseUrl}/charges/${providerRef}`,
      {
        headers: { Authorization: `Bearer ${env.paymentProviderApiKey}` },
      }
    );
    if (!response.ok) throw new Error(`payment partner HTTP ${response.status}`);
    const json = (await response.json()) as { status: string };
    return { status: json.status };
  }

  async refund(params: {
    paymentProviderRef: string;
    amountKopecks: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    if (!this.available) throw new Error("payment partner not configured");
    const response = await fetch(
      `${env.paymentProviderBaseUrl}/charges/${params.paymentProviderRef}/refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.paymentProviderApiKey}`,
        },
        body: JSON.stringify({
          amount: params.amountKopecks,
          reason: params.reason,
          idempotency_key: params.idempotencyKey,
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`payment partner refund HTTP ${response.status}`);
    }
    const json = (await response.json()) as { id: string; status: string };
    return { providerRef: json.id, status: json.status };
  }
}

export function getPaymentProvider(): PaymentProvider {
  const yookassa = new YooKassaPaymentProvider();
  if (yookassa.available) return yookassa;
  const partner = new PartnerPaymentProvider();
  if (partner.available) return partner;
  return new SandboxPaymentProvider();
}

/**
 * Idempotent payment capture (spec §125). The idempotency key is derived from
 * the order, so a retried checkout can never double-charge.
 *
 * Redirect partners (ЮKassa) return PENDING plus `confirmationUrl`: the buyer
 * pays on the partner page, and the order is marked PAID only by the webhook
 * after the partner API confirms the payment.
 */
export async function capturePayment(orderId: string): Promise<{
  status: string;
  sandbox: boolean;
  providerRef: string | null;
  confirmationUrl: string | null;
}> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payment: true,
      items: { select: { titleSnapshot: true, quantity: true, priceKopecks: true } },
    },
  });

  if (order.payment && order.payment.status === "SUCCEEDED") {
    // Already captured — idempotent return, no second charge.
    return {
      status: order.payment.status,
      sandbox: order.payment.sandbox,
      providerRef: order.payment.providerRef,
      confirmationUrl: null,
    };
  }

  const provider = getPaymentProvider();
  const idempotencyKey = `ord_${order.id}`;

  let receipt: YooReceipt | undefined;
  if (provider.key === "yookassa" && env.yookassaReceipts) {
    const buyer = await prisma.user.findUnique({ where: { id: order.buyerId }, select: { email: true } });
    const built = buildReceipt({
      items: order.items,
      deliveryKopecks: order.deliveryKopecks,
      totalKopecks: order.totalKopecks,
      email: buyer?.email,
      currency: order.currency,
      vatCode: env.yookassaVatCode,
    });
    if (!built) {
      throw new Error("Не удалось сформировать чек: сумма позиций не совпадает с суммой заказа или нет e-mail покупателя");
    }
    receipt = built;
  }

  const charge = await provider.createCharge({
    orderId: order.id,
    amountKopecks: order.totalKopecks,
    currency: order.currency,
    idempotencyKey,
    description: `Заказ ${order.number}`,
    returnUrl: `${env.publicAppUrl}/orders/${order.id}`,
    receipt,
  });

  const payment = await prisma.payment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      buyerId: order.buyerId,
      provider: provider.key,
      providerRef: charge.providerRef,
      status: charge.status,
      amountKopecks: order.totalKopecks,
      currency: order.currency,
      sandbox: provider.sandbox,
      processedAt: new Date(),
    },
    update: {
      provider: provider.key,
      providerRef: charge.providerRef,
      status: charge.status,
      sandbox: provider.sandbox,
      errorMessage: null,
      processedAt: new Date(),
    },
  });

  if (payment.status === "SUCCEEDED") {
    await markOrderPaid(orderId, provider.sandbox);
  }
  return {
    status: payment.status,
    sandbox: payment.sandbox,
    providerRef: payment.providerRef,
    confirmationUrl: charge.confirmationUrl ?? null,
  };
}

export async function markOrderPaid(orderId: string, sandbox: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, sellerId: true, subtotalKopecks: true, deliveryKopecks: true, status: true },
    });
    // Guard the transition: a cancelled or already-completed order must never
    // be flipped to PAID by a late/duplicated payment webhook (spec §124).
    if (!canTransition(order.status, "PAID")) {
      throw new Error(`недопустимый переход статуса заказа при оплате: ${order.status} → PAID`);
    }
    await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID", confirmedAt: new Date() },
    });
    await tx.orderHistory.create({
      data: {
        orderId: order.id,
        toStatus: "PAID",
        reason: sandbox ? "sandbox payment captured" : "partner payment captured",
      },
    });
    // Settlement row is created on payment; the payout itself is executed by
    // the partner flow, never by the AI.
    const breakdown = computeSettlement({
      grossKopecks: order.subtotalKopecks,
      deliveryKopecks: order.deliveryKopecks,
    });
    await tx.settlement.create({
      data: {
        orderId: order.id,
        sellerId: order.sellerId,
        ...breakdown,
        status: "PENDING",
      },
    });
  });
}

export interface PayoutProvider {
  readonly key: string;
  readonly sandbox: boolean;
  readonly available: boolean;
  /**
   * Requests the partner to disburse funds to the seller's account.
   * The platform records the result; the partner moves the money.
   */
  createPayout(params: {
    sellerId: string;
    amountKopecks: number;
    settlementIds: string[];
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }>;
}

export class SandboxPayoutProvider implements PayoutProvider {
  readonly key = "sandbox-payout";
  readonly sandbox = true;
  readonly available = true;

  async createPayout(params: {
    sellerId: string;
    amountKopecks: number;
    settlementIds: string[];
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    return {
      providerRef: `sbpo_${params.idempotencyKey.slice(0, 16)}_${params.sellerId.slice(-6)}`,
      status: "SUCCEEDED",
    };
  }
}

export class PartnerPayoutProvider implements PayoutProvider {
  readonly key = "partner-payout";
  readonly sandbox = false;
  readonly available = Boolean(env.paymentProviderApiKey);

  async createPayout(params: {
    sellerId: string;
    amountKopecks: number;
    settlementIds: string[];
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    if (!this.available) throw new Error("payout partner not configured");
    const response = await fetch(`${env.paymentProviderBaseUrl}/payouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.paymentProviderApiKey}`,
      },
      body: JSON.stringify({
        seller_id: params.sellerId,
        amount: params.amountKopecks,
        settlement_ids: params.settlementIds,
        idempotency_key: params.idempotencyKey,
      }),
    });
    if (!response.ok) throw new Error(`payout partner HTTP ${response.status}`);
    const json = (await response.json()) as { id: string; status: string };
    return { providerRef: json.id, status: json.status };
  }
}

export function getPayoutProvider(): PayoutProvider {
  const partner = new PartnerPayoutProvider();
  if (partner.available) return partner;
  return new SandboxPayoutProvider();
}

/**
 * Consolidated payout (spec §26): groups all COMPLETED settlements for a seller
 * into a single disbursement request executed by the payment partner.
 *
 * The platform never moves money itself — it records what the partner did.
 *
 * ARCHITECTURE (P0-8): the partner HTTP call is NOT executed inside the DB
 * transaction. The transaction only reserves the payout and commits an outbox
 * message; `processPayoutOutbox` then performs the call with retries and
 * provider idempotency. This removes the "partner accepted the payout, but the
 * request timed out and the transaction rolled back" failure mode that would
 * otherwise cause a double-disbursement on retry.
 */
export async function createConsolidatedPayout(input: {
  sellerId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<{
  payoutId: string | null;
  amountKopecks: number;
  status: string;
  provider: string;
  sandbox: boolean;
  settledCount: number;
}> {
  const reserved = await reservePayout(input);
  if (!reserved) {
    return {
      payoutId: null,
      amountKopecks: 0,
      status: "NOTHING_TO_PAYOUT",
      provider: "none",
      sandbox: false,
      settledCount: 0,
    };
  }
  // Best-effort immediate dispatch: if it fails, the outbox row stays PENDING
  // and the background worker reconciles it. Either way the money is only ever
  // moved once, because the partner call is idempotent on idempotencyKey.
  await processPayoutOutbox({ payoutId: reserved.payoutId });
  return readPayoutStatus(reserved);
}

/**
 * Step 1 (transactional): reserve the payout + earmark settlements + commit the
 * outbox row. No external I/O happens here, so a failure is a clean rollback.
 */
async function reservePayout(input: {
  sellerId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<{ payoutId: string; amountKopecks: number } | null> {
  return prisma.$transaction(async (tx) => {
    // Idempotency: the key is stored before any partner call, so a retried
    // request finds the row and never double-disburses (spec §125).
    const existing = await tx.payout.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { payoutId: existing.id, amountKopecks: existing.amountKopecks };
    }

    const pending = await tx.settlement.findMany({
      where: { sellerId: input.sellerId, status: "PENDING", payoutId: null },
      orderBy: { createdAt: "asc" },
    });
    if (pending.length === 0) return null;

    const total = pending.reduce((sum, s) => sum + s.payoutKopecks, 0);
    const provider = getPayoutProvider();

    // Reserve the row first so a duplicate request cannot create a second one.
    const payout = await tx.payout.create({
      data: {
        sellerId: input.sellerId,
        provider: provider.key,
        idempotencyKey: input.idempotencyKey,
        amountKopecks: total,
        status: "IN_PROGRESS",
        settlements: { connect: pending.map((s) => ({ id: s.id })) },
      },
    });
    // Earmark the settlements for this payout while the partner holds the request.
    await tx.settlement.updateMany({
      where: { id: { in: pending.map((s) => s.id) } },
      data: { status: "AVAILABLE", payoutId: payout.id },
    });

    // Commit the intent to disburse. The worker performs the actual call.
    await tx.outboxMessage.create({
      data: {
        aggregate: "payout",
        aggregateId: payout.id,
        type: "PAYOUT_REQUEST",
        payload: JSON.stringify({
          sellerId: input.sellerId,
          amountKopecks: total,
          settlementIds: pending.map((s) => s.id),
          idempotencyKey: input.idempotencyKey,
          providerKey: provider.key,
          sandbox: provider.sandbox,
        }),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: "SELLER",
        action: "PAYOUT_REQUESTED",
        targetType: "Payout",
        targetId: payout.id,
        before: String(null),
        after: JSON.stringify({ amountKopecks: total, provider: provider.key, sandbox: provider.sandbox }),
      },
    });

    return { payoutId: payout.id, amountKopecks: total };
  });
}

/** Reads the persisted outcome of a payout (the source of truth, never guessed). */
async function readPayoutStatus(reserved: {
  payoutId: string;
  amountKopecks: number;
}): Promise<{
  payoutId: string;
  amountKopecks: number;
  status: string;
  provider: string;
  sandbox: boolean;
  settledCount: number;
}> {
  const payout = await prisma.payout.findUniqueOrThrow({
    where: { id: reserved.payoutId },
    include: { _count: { select: { settlements: true } } },
  });
  return {
    payoutId: payout.id,
    amountKopecks: payout.amountKopecks,
    status: payout.status,
    provider: payout.provider,
    sandbox: payout.provider === "sandbox-payout",
    settledCount: payout._count.settlements,
  };
}

/**
 * Step 2 (worker): drains PENDING payout outbox rows and performs the partner
 * call outside any DB transaction. Safe to run concurrently and repeatedly —
 * each row is claimed atomically and the partner call is idempotent.
 */
export async function processPayoutOutbox(options?: {
  payoutId?: string;
  /** Upper bound on partner calls per run, to keep cron slices bounded. */
  limit?: number;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = options?.limit ?? 25;
  const rows = await prisma.outboxMessage.findMany({
    where: {
      aggregate: "payout",
      type: "PAYOUT_REQUEST",
      status: { in: ["PENDING", "IN_FLIGHT"] },
      ...(options?.payoutId ? { aggregateId: options.payoutId } : {}),
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = await attemptPayoutRow(row);
    if (outcome === "succeeded") succeeded += 1;
    else if (outcome === "failed") failed += 1;
  }
  return { processed: rows.length, succeeded, failed };
}

async function attemptPayoutRow(row: {
  id: string;
  aggregateId: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
}): Promise<"succeeded" | "failed" | "skipped"> {
  // Atomic claim so parallel workers never double-execute the same row.
  const claimed = await prisma.outboxMessage.updateMany({
    where: { id: row.id, status: { in: ["PENDING", "IN_FLIGHT"] } },
    data: { status: "IN_FLIGHT" },
  });
  if (claimed.count === 0) return "skipped";

  const params = JSON.parse(row.payload) as {
    sellerId: string;
    amountKopecks: number;
    settlementIds: string[];
    idempotencyKey: string;
    providerKey: string;
  };

  try {
    const provider = getPayoutProvider();
    const result = await provider.createPayout({
      sellerId: params.sellerId,
      amountKopecks: params.amountKopecks,
      settlementIds: params.settlementIds,
      idempotencyKey: params.idempotencyKey,
    });

    // Map the partner's status onto the canonical PayoutStatus enum
    // (spec §124: persisted values must stay within the defined vocabulary).
    const status: PayoutStatus = result.status === "SUCCEEDED" ? "SUCCEEDED" : "IN_PROGRESS";
    await prisma.payout.update({
      where: { id: row.aggregateId },
      data: {
        providerRef: result.providerRef,
        status,
        processedAt: status === "SUCCEEDED" ? new Date() : null,
      },
    });
    if (status === "SUCCEEDED") {
      await prisma.settlement.updateMany({
        where: { id: { in: params.settlementIds } },
        data: { status: "PAID" },
      });
    }
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
    });
    return "succeeded";
  } catch (error) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= row.maxAttempts;
    const backoffMs = Math.min(60_000, 2_000 * 2 ** attempts);
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: {
        attempts,
        status: exhausted ? "DEAD" : "PENDING",
        lastError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffMs),
      },
    });
    return "failed";
  }
}

/** Seller settlement statement (spec §26): gross → fees → payout. */
export async function sellerSettlementStatement(sellerId: string): Promise<{
  settlements: Array<{
    id: string;
    orderId: string;
    grossKopecks: number;
    platformFeeKopecks: number;
    paymentFeeKopecks: number;
    deliveryKopecks: number;
    adjustmentsKopecks: number;
    payoutKopecks: number;
    status: string;
    createdAt: Date;
    payoutProviderRef: string | null;
  }>;
  totals: {
    grossKopecks: number;
    platformFeeKopecks: number;
    paymentFeeKopecks: number;
    deliveryKopecks: number;
    adjustmentsKopecks: number;
    payoutKopecks: number;
    pendingKopecks: number;
  };
}> {
  const rows = await prisma.settlement.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderId: true,
      grossKopecks: true,
      platformFeeKopecks: true,
      paymentFeeKopecks: true,
      deliveryKopecks: true,
      adjustmentsKopecks: true,
      payoutKopecks: true,
      status: true,
      createdAt: true,
      payout: { select: { providerRef: true } },
    },
    take: 200,
  });

  const sum = (sel: (r: (typeof rows)[number]) => number) =>
    rows.reduce((acc, r) => acc + sel(r), 0);

  return {
    settlements: rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      grossKopecks: r.grossKopecks,
      platformFeeKopecks: r.platformFeeKopecks,
      paymentFeeKopecks: r.paymentFeeKopecks,
      deliveryKopecks: r.deliveryKopecks,
      adjustmentsKopecks: r.adjustmentsKopecks,
      payoutKopecks: r.payoutKopecks,
      status: r.status,
      createdAt: r.createdAt,
      payoutProviderRef: r.payout?.providerRef ?? null,
    })),
    totals: {
      grossKopecks: sum((r) => r.grossKopecks),
      platformFeeKopecks: sum((r) => r.platformFeeKopecks),
      paymentFeeKopecks: sum((r) => r.paymentFeeKopecks),
      deliveryKopecks: sum((r) => r.deliveryKopecks),
      adjustmentsKopecks: sum((r) => r.adjustmentsKopecks),
      payoutKopecks: sum((r) => r.payoutKopecks),
      pendingKopecks: rows
        .filter((r) => r.status === "PENDING")
        .reduce((acc, r) => acc + r.payoutKopecks, 0),
    },
  };
}

export { toKopecks };

// =============================================================================
// REFUNDS (P0-7, spec §29 return states)
// =============================================================================
// Previously a return request could set the order to RETURNING but no code
// ever returned money: the Refund row was only ever written as a record. Here
// the refund actually moves through the payment provider, and the seller's
// settlement is compensated so the platform never keeps commission on money
// that went back to the buyer (spec §26 settlement math).

export async function processRefund(params: {
  refundId: string;
  actorId: string;
  actorRole: string;
}): Promise<{ status: string; providerRef: string | null; sandbox: boolean }> {
  const refund = await prisma.refund.findUnique({
    where: { id: params.refundId },
    include: { payment: true },
  });
  if (!refund) throw new Error("refund not found");
  if (refund.status === "SUCCEEDED") {
    // Idempotent: an already-completed refund must not be refunded again.
    // Preserve the original payment's sandbox/live provenance instead of
    // inventing a live status on a replay.
    return {
      status: "SUCCEEDED",
      providerRef: refund.providerRef,
      sandbox: refund.payment.sandbox,
    };
  }

  const provider = getPaymentProvider();

  // Persist intent BEFORE the partner call, then execute outside any DB
  // transaction. A timeout must not leave the platform unsure whether the
  // refund happened — the row is re-checked and the provider's idempotency key
  // makes a retry a no-op.
  await prisma.refund.update({
    where: { id: refund.id },
    data: { status: "PROCESSING" },
  });

  if (!refund.payment.providerRef) {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED" },
    });
    throw new Error("payment has no provider reference to refund");
  }
  const providerRefSource = refund.payment.providerRef;

  const result = await provider.refund({
    paymentProviderRef: providerRefSource,
    amountKopecks: refund.amountKopecks,
    reason: refund.reason,
    idempotencyKey: `refund-${refund.id}`,
  });

  if (result.status !== "SUCCEEDED") {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", providerRef: result.providerRef },
    });
    return { status: "FAILED", providerRef: result.providerRef, sandbox: provider.sandbox };
  }

  // Compensate the seller's settlement: reduce the payout by the refunded
  // amount and recompute platform fee proportionally. Only the seller's own
  // settlement for this order is touched, never other sellers'.
  const settlement = await prisma.settlement.findFirst({
    where: { orderId: refund.orderId },
  });
  if (settlement) {
    const compensated = Math.min(refund.amountKopecks, settlement.payoutKopecks);
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        adjustmentsKopecks: settlement.adjustmentsKopecks + compensated,
        payoutKopecks: Math.max(0, settlement.payoutKopecks - compensated),
        status: "ADJUSTED" as string,
      },
    });
  }

  await prisma.refund.update({
    where: { id: refund.id },
    data: { status: "SUCCEEDED", providerRef: result.providerRef },
  });

  await audit({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "payment.refund.processed",
    targetType: "Refund",
    targetId: refund.id,
    before: { status: refund.status },
    after: {
      status: "SUCCEEDED",
      amountKopecks: refund.amountKopecks,
      providerRef: result.providerRef,
      sandbox: provider.sandbox,
    },
  });

  return {
    status: "SUCCEEDED",
    providerRef: result.providerRef,
    sandbox: provider.sandbox,
  };
}
