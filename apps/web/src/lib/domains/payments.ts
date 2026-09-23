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
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { canTransition } from "./orders";
import { toKopecks } from "../utils";
import type { PayoutStatus } from "../db/enums";

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

export interface PaymentProvider {
  readonly key: string;
  readonly sandbox: boolean;
  readonly available: boolean;
  createCharge(params: {
    orderId: string;
    amountKopecks: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }>;
  getStatus(providerRef: string): Promise<{ status: string }>;
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly key = "sandbox-payment";
  readonly sandbox = true;
  readonly available = true;

  async createCharge(params: {
    orderId: string;
    amountKopecks: number;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
    // Deterministic fake reference. Real money never moves.
    return {
      providerRef: `sb_${params.idempotencyKey.slice(0, 16)}_${params.orderId.slice(-6)}`,
      status: "SUCCEEDED",
    };
  }

  async getStatus(providerRef: string): Promise<{ status: string }> {
    return { status: providerRef.startsWith("sb_") ? "SUCCEEDED" : "UNKNOWN" };
  }
}

export class PartnerPaymentProvider implements PaymentProvider {
  readonly key = "partner-payment";
  readonly sandbox = false;
  readonly available = Boolean(env.paymentProviderApiKey);

  async createCharge(params: {
    orderId: string;
    amountKopecks: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: string }> {
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
}

export function getPaymentProvider(): PaymentProvider {
  const partner = new PartnerPaymentProvider();
  if (partner.available) return partner;
  return new SandboxPaymentProvider();
}

/**
 * Idempotent payment capture (spec §125). The idempotency key is derived from
 * the order, so a retried checkout can never double-charge.
 */
export async function capturePayment(orderId: string): Promise<{
  status: string;
  sandbox: boolean;
  providerRef: string | null;
}> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payment: true },
  });

  if (order.payment && order.payment.status === "SUCCEEDED") {
    // Already captured — idempotent return, no second charge.
    return {
      status: order.payment.status,
      sandbox: order.payment.sandbox,
      providerRef: order.payment.providerRef,
    };
  }

  const provider = getPaymentProvider();
  const idempotencyKey = `ord_${order.id}`;
  const charge = await provider.createCharge({
    orderId: order.id,
    amountKopecks: order.totalKopecks,
    currency: order.currency,
    idempotencyKey,
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
 * Idempotent on `idempotencyKey`: a retried request returns the existing payout.
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
  return prisma.$transaction(async (tx) => {
    // Idempotency: the key is stored before the partner call, so a retried
    // request finds the row and never double-disburses (spec §125).
    const existing = await tx.payout.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        payoutId: existing.id,
        amountKopecks: existing.amountKopecks,
        status: existing.status,
        provider: existing.provider,
        sandbox: existing.provider === "sandbox-payout",
        settledCount: 0,
      };
    }

    const pending = await tx.settlement.findMany({
      where: { sellerId: input.sellerId, status: "PENDING", payoutId: null },
      orderBy: { createdAt: "asc" },
    });
    if (pending.length === 0) {
      return {
        payoutId: null,
        amountKopecks: 0,
        status: "NOTHING_TO_PAYOUT",
        provider: "none",
        sandbox: false,
        settledCount: 0,
      };
    }

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

    const result = await provider.createPayout({
      sellerId: input.sellerId,
      amountKopecks: total,
      settlementIds: pending.map((s) => s.id),
      idempotencyKey: input.idempotencyKey,
    });

    // Map the partner's status onto the canonical PayoutStatus enum
    // (spec §124: persisted values must stay within the defined vocabulary).
    const status: PayoutStatus = result.status === "SUCCEEDED" ? "SUCCEEDED" : "IN_PROGRESS";
    await tx.payout.update({
      where: { id: payout.id },
      data: {
        providerRef: result.providerRef,
        status,
        processedAt: status === "SUCCEEDED" ? new Date() : null,
      },
    });
    // On success the settlement is fully paid out. (While the partner holds the
    // request it stays AVAILABLE, which was set when the row was reserved above.)
    if (status === "SUCCEEDED") {
      await tx.settlement.updateMany({
        where: { id: { in: pending.map((s) => s.id) } },
        data: { status: "PAID" },
      });
    }

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

    return {
      payoutId: payout.id,
      amountKopecks: total,
      status,
      provider: provider.key,
      sandbox: provider.sandbox,
      settledCount: pending.length,
    };
  });
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
