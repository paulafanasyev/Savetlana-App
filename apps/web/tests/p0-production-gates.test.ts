/**
 * Tests for the P0 production-gate fixes.
 *
 * These exist because each one closes a hole an external audit found in real
 * code, and a regression that silently reopens any of them must fail CI.
 */
import { describe, it, expect } from "vitest";
import { storeSecret, loadSecret, secretUsable } from "../src/lib/domains/secret-store";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { runJobs, jobBacklog } from "../src/lib/domains/jobs";
import { capturePayment } from "../src/lib/domains/payments";
import { processRefund } from "../src/lib/domains/payments";
import { transitionOrder } from "../src/lib/domains/orders";

const W = process.env.VITEST_WORKER_ID ?? "0";
const EMAIL = `p0-buyer@${W}.test`;
const SELLER_EMAIL = `p0-seller@${W}.test`;

describe("secret store (P0-2: OAuth token storage)", () => {
  it("round-trips a token and reports it usable", () => {
    const blob = storeSecret({ value: "vk_access_token_123", expiresAt: null });
    const out = loadSecret(blob);
    expect(out).not.toBeNull();
    expect(out!.value).toBe("vk_access_token_123");
    expect(secretUsable(blob)).toBe(true);
  });

  it("round-trips an expiry timestamp", () => {
    const expires = new Date(Date.now() + 3600_000);
    const blob = storeSecret({ value: "tok", expiresAt: expires });
    expect(loadSecret(blob)!.expiresAt?.toISOString()).toBe(expires.toISOString());
  });

  it("treats an expired secret as unusable", () => {
    const past = new Date(Date.now() - 1000);
    const blob = storeSecret({ value: "tok", expiresAt: past });
    expect(secretUsable(blob)).toBe(false);
  });

  it("rejects a tampered ciphertext", () => {
    const blob = storeSecret({ value: "tok", expiresAt: null });
    const [enc, iv, tag] = blob.split(".");
    const tampered = [enc.slice(0, -4) + "AAAA", iv, tag].join(".");
    expect(loadSecret(tampered)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(loadSecret(null)).toBeNull();
    expect(loadSecret(undefined)).toBeNull();
    expect(loadSecret("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Jobs engine (P0-18) & refund (P0-7)
// ---------------------------------------------------------------------------

async function ensureFixtures() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { name: "P0 Buyer", email: EMAIL, passwordHash: await hashPassword("password123"), role: "BUYER" },
    update: {},
  });
  const sellerUser = await prisma.user.upsert({
    where: { email: SELLER_EMAIL },
    create: { name: "P0 Seller", email: SELLER_EMAIL, passwordHash: await hashPassword("password123"), role: "SELLER" },
    update: {},
  });
  const seller = await prisma.sellerProfile.upsert({
    where: { userId: sellerUser.id },
    create: { userId: sellerUser.id, displayName: "P0 Seller", slug: `p0-seller-${W}` },
    update: {},
  });
  const product = await prisma.product.upsert({
    where: { sku: `p0-sku-${W}` },
    create: {
      sku: `p0-sku-${W}`,
      title: "P0 товар",
      priceKopecks: 200000,
      sellerId: seller.id,
      status: "PUBLISHED",
      description: "Тест",
    },
    update: { priceKopecks: 200000, status: "PUBLISHED" },
  });
  await prisma.inventory.upsert({
    where: { productId: product.id },
    create: { productId: product.id, quantity: 3, availability: "AVAILABLE", confirmedAt: new Date() },
    update: { quantity: 3, availability: "AVAILABLE", confirmedAt: new Date() },
  });
  return { userId: user.id, sellerId: seller.id, productId: product.id };
}

describe("background jobs engine (P0-18)", () => {
  it("runs every category without throwing and reports per-category health", async () => {
    const result = await runJobs();
    expect(result.categories).toHaveProperty("payout_outbox");
    expect(result.categories).toHaveProperty("stale_availability");
    expect(result.categories).toHaveProperty("expired_documents");
    expect(result.categories).toHaveProperty("tracking_sync");
    expect(result.categories).toHaveProperty("outbox_deadletter");
    // A failure in one category is reported, not thrown, so a single broken
    // sweep cannot take the whole worker down.
    for (const [, cat] of Object.entries(result.categories)) {
      expect(typeof cat.ok).toBe("boolean");
      expect(typeof cat.detail).toBe("string");
    }
  });

  it("reports backlog counts an operator can act on", async () => {
    await ensureFixtures();
    const backlog = await jobBacklog();
    expect(typeof backlog.payoutOutboxPending).toBe("number");
    expect(typeof backlog.shipmentsAwaitingTrackingSync).toBe("number");
    expect(typeof backlog.deadLetters).toBe("number");
  });
});

describe("refund processing (P0-7)", () => {
  it("refunds a paid order through the provider and compensates the settlement", async () => {
    const { userId, sellerId, productId } = await ensureFixtures();

    const group = await prisma.orderGroup.create({
      data: {
        buyerId: userId,
        idempotencyKey: `p0-refund-${W}-${Date.now()}`,
        totalKopecks: 200000,
        currency: "RUB",
      },
    });
    const order = await prisma.order.create({
      data: {
        groupId: group.id,
        buyerId: userId,
        sellerId,
        number: `P0-R-${W}-${Date.now()}`,
        status: "PAYMENT_PENDING",
        totalKopecks: 200000,
        currency: "RUB",
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId,
        titleSnapshot: "P0 товар",
        quantity: 1,
        priceKopecks: 200000,
      },
    });

    await capturePayment(order.id);
    await transitionOrder({
      orderId: order.id,
      to: "PAID",
      actorId: "system",
      actorRole: "system",
      actingUserId: userId,
    });

    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    await prisma.settlement.create({
      data: {
        orderId: order.id,
        sellerId,
        grossKopecks: 200000,
        platformFeeKopecks: 3000,
        paymentFeeKopecks: 4000,
        deliveryKopecks: 0,
        adjustmentsKopecks: 0,
        payoutKopecks: 193000,
        status: "PENDING",
      },
    });

    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        amountKopecks: 200000,
        reason: "ITEM_NOT_AS_DESCRIBED",
      },
    });

    const result = await processRefund({ refundId: refund.id, actorId: userId, actorRole: "buyer" });
    expect(result.status).toBe("SUCCEEDED");

    // The seller's settlement must no longer hold the refunded money.
    const settlement = await prisma.settlement.findFirstOrThrow({ where: { orderId: order.id } });
    expect(settlement.status).toBe("ADJUSTED");
    expect(settlement.payoutKopecks).toBe(0);

    const after = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(after.status).toBe("SUCCEEDED");
    expect(after.providerRef).toBeTruthy();
  });

  it("is idempotent: reprocessing a completed refund does not refund again", async () => {
    const { userId, sellerId, productId } = await ensureFixtures();

    const group = await prisma.orderGroup.create({
      data: {
        buyerId: userId,
        idempotencyKey: `p0-refund-2-${W}-${Date.now()}`,
        totalKopecks: 200000,
        currency: "RUB",
      },
    });
    const order = await prisma.order.create({
      data: {
        groupId: group.id,
        buyerId: userId,
        sellerId,
        number: `P0-R2-${W}-${Date.now()}`,
        status: "PAYMENT_PENDING",
        totalKopecks: 200000,
        currency: "RUB",
      },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId, titleSnapshot: "P0 товар", quantity: 1, priceKopecks: 200000 },
    });
    await capturePayment(order.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });

    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        amountKopecks: 200000,
        reason: "WRONG_ITEM",
      },
    });

    const first = await processRefund({ refundId: refund.id, actorId: userId, actorRole: "buyer" });
    expect(first.status).toBe("SUCCEEDED");
    const firstRef = first.providerRef;

    // Second call must be a no-op returning the same provider reference.
    const second = await processRefund({ refundId: refund.id, actorId: userId, actorRole: "buyer" });
    expect(second.status).toBe("SUCCEEDED");
    expect(second.providerRef).toBe(firstRef);
  });
});
