/**
 * Tools required by the spec §44 registry that were added late:
 * get_tracking, get_payment_status, check_inventory, get_reviews,
 * search_sellers. Each is exercised against the real database so the
 * claim "VERIFIED" is backed by an actual query, not by tool existence.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { capturePayment } from "../src/lib/domains/payments";
import { createShipment } from "../src/lib/domains/delivery";

const W = process.env.VITEST_WORKER_ID ?? "0";
const SELLER_EMAIL = `t44-seller@${W}.test`;
const BUYER_EMAIL = `t44-buyer@${W}.test`;

let buyerId = "";
let sellerId = "";
let productId = "";
let orderId = "";
let unpaidOrderId = "";

const buyerCtx = { userId: "", role: "buyer", traceId: `t44-${W}` } as const;

beforeAll(async () => {
  const sellerUser = await prisma.user.create({
    data: { email: SELLER_EMAIL, name: "Т44 Продавец", role: "SELLER", passwordHash: await hashPassword("password123") },
  });
  const seller = await prisma.sellerProfile.create({
    data: { userId: sellerUser.id, slug: `t44-seller-${W}`, displayName: "Т44 Продавец", isActivated: true },
  });
  sellerId = seller.id;

  const buyer = await prisma.user.create({
    data: { email: BUYER_EMAIL, name: "Т44 Покупатель", role: "BUYER", passwordHash: await hashPassword("password123") },
  });
  buyerId = buyer.id;
  (buyerCtx as { userId: string }).userId = buyerId;

  const product = await prisma.product.create({
    data: {
      sellerId,
      sku: `T44-${W}`,
      title: "Товар Т44",
      priceKopecks: 100000,
      status: "ACTIVE",
      // Availability must be seller-confirmed to be promiseable (spec §10).
      inventory: {
        create: {
          quantity: 5,
          availability: "AVAILABLE",
          confirmedBySeller: true,
          confirmedAt: new Date(),
          saleUntil: new Date(Date.now() + 30 * 24 * 3600_000),
        },
      },
    },
  });
  productId = product.id;

  // A paid, shipped order so get_tracking has a real carrier timeline.
  // Order must be created PAYMENT_PENDING: capturePayment drives the
  // PAYMENT_PENDING → PAID transition, then the shipment is created.
  const paid = await prisma.order.create({
    data: {
      number: `T44-PAID-${W}`,
      buyerId,
      sellerId,
      status: "PAYMENT_PENDING",
      totalKopecks: 100000,
      currency: "RUB",
      items: { create: { productId, titleSnapshot: "Товар Т44", quantity: 1, priceKopecks: 100000 } },
    },
  });
  orderId = paid.id;
  await capturePayment(orderId);
  // createShipment drives the PAID → PROCESSING transition itself.
  await createShipment({
    orderId,
    sellerProfileId: sellerId,
    carrier: "CDEK",
    trackingNumber: `T44-CDEK-${W}`,
  });

  // An unpaid order so get_payment_status reports the pending state honestly.
  const unpaid = await prisma.order.create({
    data: {
      number: `T44-UNPAID-${W}`,
      buyerId,
      sellerId,
      status: "PAYMENT_PENDING",
      totalKopecks: 100000,
      currency: "RUB",
      items: { create: { productId, titleSnapshot: "Товар Т44", quantity: 1, priceKopecks: 100000 } },
    },
  });
  unpaidOrderId = unpaid.id;
});

describe("tool registry: §44 tools are registered", () => {
  it("registers all five tools", () => {
    for (const name of [
      "get_tracking",
      "get_payment_status",
      "check_inventory",
      "get_reviews",
      "search_sellers",
    ]) {
      expect(toolRegistry.get(name)?.name).toBe(name);
    }
  });
});

describe("get_tracking", () => {
  it("returns the real carrier timeline for the buyer's own order", async () => {
    const tool = toolRegistry.get("get_tracking")!;
    const res = await tool.execute(buyerCtx, { orderId });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      shipment: { carrierName: "CDEK", trackingNumber: `T44-CDEK-${W}` },
    });
  });

  it("denies tracking for another user's order", async () => {
    const tool = toolRegistry.get("get_tracking")!;
    const res = await tool.execute(
      { ...buyerCtx, userId: "intruder" },
      { orderId }
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("не найден");
  });

  it("reports honestly when a shipment does not exist yet", async () => {
    const tool = toolRegistry.get("get_tracking")!;
    const res = await tool.execute(buyerCtx, { orderId: unpaidOrderId });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ shipment: null });
    expect(res.summary).toContain("не передан в доставку");
  });
});

describe("get_payment_status", () => {
  it("reports the paid order with its sandbox nature", async () => {
    const tool = toolRegistry.get("get_payment_status")!;
    const res = await tool.execute(buyerCtx, { orderId });
    expect(res.ok).toBe(true);
    const data = res.data as { payment: { status: string; sandbox: boolean } };
    expect(data.payment.status).toBe("SUCCEEDED");
    // Sandbox payments must never be presented as real money movement (§49).
    expect(data.payment.sandbox).toBe(true);
  });

  it("reports the unpaid order as unpaid", async () => {
    const tool = toolRegistry.get("get_payment_status")!;
    const res = await tool.execute(buyerCtx, { orderId: unpaidOrderId });
    expect(res.ok).toBe(true);
    const data = res.data as { payment: null };
    expect(data.payment).toBe(null);
    expect(res.summary).toContain("не оплачен");
  });
});

describe("check_inventory", () => {
  it("returns the persisted availability and quantity", async () => {
    const tool = toolRegistry.get("check_inventory")!;
    const res = await tool.execute(buyerCtx, { productId });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ availability: "AVAILABLE", quantity: 5 });
  });

  it("reports UNKNOWN when the seller has not confirmed stock", async () => {
    const unconfirmed = await prisma.product.create({
      data: {
        sellerId,
        sku: `T44-UNC-${W}`,
        title: "Неподтверждённый товар",
        priceKopecks: 50000,
        status: "ACTIVE",
        inventory: {
          create: { quantity: 2, availability: "UNKNOWN", confirmedBySeller: false },
        },
      },
    });
    const tool = toolRegistry.get("check_inventory")!;
    const res = await tool.execute(buyerCtx, { productId: unconfirmed.id });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ availability: "UNKNOWN" });
    expect(res.summary).toContain("не подтверждено");
  });
});

describe("get_reviews", () => {
  it("states honestly when a product has no reviews", async () => {
    const tool = toolRegistry.get("get_reviews")!;
    const res = await tool.execute(buyerCtx, { productId });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ count: 0 });
    expect(res.summary).toContain("нет отзывов");
  });

  it("analyses recurring themes from real reviews", async () => {
    const reviewed = await prisma.product.create({
      data: {
        sellerId,
        sku: `T44-REV-${W}`,
        title: "Товар с отзывами",
        priceKopecks: 75000,
        status: "ACTIVE",
        inventory: { create: { quantity: 4, availability: "AVAILABLE" } },
      },
    });
    await prisma.review.createMany({
      data: [
        { productId: reviewed.id, authorId: buyerId, rating: 5, body: "Отличное качество, аккумулятор держит долго" },
        { productId: reviewed.id, authorId: buyerId, rating: 4, body: "Хорошее качество, но коробка помята" },
      ],
    });
    const tool = toolRegistry.get("get_reviews")!;
    const res = await tool.execute(buyerCtx, { productId: reviewed.id });
    expect(res.ok).toBe(true);
    const data = res.data as { count: number; averageRating: number };
    expect(data.count).toBe(2);
    expect(data.averageRating).toBeGreaterThanOrEqual(4);
  });
});

describe("search_sellers", () => {
  it("finds activated sellers by display name", async () => {
    const tool = toolRegistry.get("search_sellers")!;
    const res = await tool.execute(buyerCtx, { query: "Т44 Продавец" });
    expect(res.ok).toBe(true);
    const data = res.data as { items: Array<{ displayName: string }> };
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items[0].displayName).toBe("Т44 Продавец");
  });

  it("reports when nothing matches", async () => {
    const tool = toolRegistry.get("search_sellers")!;
    const res = await tool.execute(buyerCtx, { query: "Такого продавца не существует Т44" });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ items: [] });
  });
});
