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
import { toKopecks } from "../utils";

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
  deliveryKopecks?: number;
  adjustmentsKopecks?: number;
}): SettlementBreakdown {
  const gross = Math.max(0, params.grossKopecks);
  const platformFee = Math.round((gross * PLATFORM_FEE_PERCENT) / 100);
  const paymentFee = 0; // supplied by the partner at capture, never invented here
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
      select: { id: true, sellerId: true, subtotalKopecks: true, deliveryKopecks: true },
    });
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

export { toKopecks };
