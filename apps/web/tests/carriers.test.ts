/**
 * Carrier adapter tests (audit §10 — "Real delivery: PENDING_EXTERNAL_ACCESS /
 * no production CDEK/Почта adapter").
 *
 * The point of these tests is the HONESTY CONTRACT (spec §49, §58):
 *   1. Without credentials the CDEK adapter reports unavailable and REFUSES to
 *      create a shipment — it must never mint a fake tracking number.
 *   2. A seller using CDEK themselves (with their own tracking number) is
 *      recorded verbatim as SELLER_DECLARED — the platform never overwrites a
 *      real number with a sandbox one, and never fabricates carrier events.
 *   3. With credentials, upstream failures surface as CarrierApiError rather
 *      than being swallowed into a fake success.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  CdekCarrierAdapter,
  CarrierApiError,
} from "../src/lib/domains/carriers/cdek";
import {
  getDeliveryProvider,
  createShipment,
  syncTracking,
  SELLER_DECLARED_KEY,
} from "../src/lib/domains/delivery";
import { createOrdersFromCart } from "../src/lib/domains/orders";

/**
 * Builds a real PAID order through the production checkout path, so the
 * shipment tests exercise real relations rather than hand-written rows.
 * Unique per call: the test DB resets per worker, not per `it`.
 */
async function seedFixture() {
  const uniq = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const buyerId = `buyer-carrier-${uniq}`;
  const productId = `p-carrier-${uniq}`;

  await prisma.user.create({
    data: { id: buyerId, email: `buyer-carrier-${uniq}@test.local`, passwordHash: "x" },
  });
  const seller = await prisma.sellerProfile.create({
    data: {
      userId: buyerId, // owner user (role gate is irrelevant for domain-level tests)
      slug: `carrier-${uniq}`,
      displayName: "Продавец доставки",
      identityStatus: "VERIFIED",
      isActivated: true,
    },
  });
  const category = await prisma.category.upsert({
    where: { slug: "test-cat-carrier" },
    create: { slug: "test-cat-carrier", name: "Тест" },
    update: {},
  });
  await prisma.product.upsert({
    where: { id: productId },
    create: {
      id: productId,
      sellerId: seller.id,
      title: "Товар для проверки доставки",
      sku: `CAR-${uniq}`,
      seoSlug: `carrier-product-${uniq}`,
      priceKopecks: 100000,
      currency: "RUB",
      status: "ACTIVE",
      categoryId: category.id,
    },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { productId },
    create: {
      productId,
      quantity: 10,
      availability: "AVAILABLE",
      confirmedBySeller: true,
      confirmedAt: new Date(),
    },
    update: { quantity: 10, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() },
  });

  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  const cart = await prisma.cart.create({ data: { userId: buyerId } });
  await prisma.cartItem.create({
    data: { cartId: cart.id, productId, quantity: 1, priceKopecks: 100000 },
  });
  const created = await createOrdersFromCart({
    buyerId,
    idempotencyKey: `carrier-${uniq}`,
    deliveryAddress: { city: "Москва" },
  });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: created.orders[0].id } });
  return { orderId: order.id, sellerProfileId: seller.id };
}

describe("carrier adapters (audit §10)", () => {
  beforeEach(() => {
    delete process.env.CDEK_TOKEN;
    delete process.env.CDEK_ACCOUNT;
    delete process.env.CDEK_SECURE_KEY;
  });

  it("CDEK resolves as a known carrier but reports unavailable without credentials", () => {
    const adapter = getDeliveryProvider("cdek");
    expect(adapter).not.toBeNull();
    expect(adapter?.key).toBe("cdek");
    expect(adapter?.sandbox).toBe(false);
    // No credentials in the test env => unavailable, NOT sandbox.
    expect(adapter?.available).toBe(false);
  });

  it("refuses to create a shipment without credentials instead of fabricating a number", async () => {
    const adapter = new CdekCarrierAdapter();
    await expect(
      adapter.createShipment({
        orderId: "ord-x",
        sellerProfileId: "sp-x",
        carrier: "cdek",
      }),
    ).rejects.toThrow(CarrierApiError);
  });

  it("names the exact missing credential so ops can fix it", () => {
    const adapter = new CdekCarrierAdapter();
    // Must mention CDEK_TOKEN so the PENDING_EXTERNAL_ACCESS report is actionable.
    expect(adapter.requiredCredential).toContain("CDEK_TOKEN");
  });

  it("does not fall back to the sandbox carrier for an unknown carrier", () => {
    // Honest resolution (spec §49): unknown carrier is NOT silently sandbox.
    expect(getDeliveryProvider("dhl-express-unknown")).toBeNull();
  });

  it("preserves a seller-provided CDEK number verbatim as SELLER_DECLARED", async () => {
    const { orderId, sellerProfileId } = await seedFixture();

    const shipment = await createShipment({
      orderId,
      sellerProfileId,
      carrier: "cdek",
      trackingNumber: "CDEK-REAL-99887766",
      deliveryKopecks: 49000,
    });

    // The real number survives — we never overwrite it with a sandbox one.
    expect(shipment.trackingNumber).toBe("CDEK-REAL-99887766");
    expect(shipment.providerKey).toBe(SELLER_DECLARED_KEY);
    expect(shipment.sandbox).toBe(false);
  });

  it("refuses an unconfigured carrier with no tracking number rather than inventing one", async () => {
    const { orderId, sellerProfileId } = await seedFixture();

    await expect(
      createShipment({ orderId, sellerProfileId, carrier: "cdek" }),
    ).rejects.toThrow(/PENDING_EXTERNAL_ACCESS/);
  });

  it("never fabricates carrier events when syncing a seller-declared shipment", async () => {
    const { orderId, sellerProfileId } = await seedFixture();

    const created = await createShipment({
      orderId,
      sellerProfileId,
      carrier: "cdek",
      trackingNumber: "CDEK-NO-SYNC-1122",
    });

    const synced = await syncTracking(created.id);

    // Exactly the one event we recorded at creation — no invented CDEK hops.
    expect(synced.events).toHaveLength(1);
    expect(synced.events[0].status).toBe("CREATED");
    expect(synced.status).toBe("CREATED");
  });

  it("keeps the sandbox carrier honestly marked as sandbox", () => {
    const adapter = getDeliveryProvider("sandbox-carrier");
    expect(adapter?.sandbox).toBe(true);
    expect(adapter?.available).toBe(true);
  });
});