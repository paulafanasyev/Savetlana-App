/**
 * Critical-path lifecycle test (spec §164 RELEASE GATE).
 *
 * Exercises the real domain services against a real database — no mocks of the
 * state machines or the payment capture. The only sandboxed component is the
 * payment provider itself, which is honestly labelled via `sandbox: true`.
 *
 *   register/cart -> checkout -> pay -> seller confirm -> ship -> track
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getCartView } from "../src/lib/domains/cart";
import { createOrdersFromCart, transitionOrder, getOrdersForBuyer } from "../src/lib/domains/orders";
import { capturePayment, getPaymentProvider, createConsolidatedPayout, sellerSettlementStatement } from "../src/lib/domains/payments";
import { createShipment, syncTracking } from "../src/lib/domains/delivery";
import { evaluateOrderRisk } from "../src/lib/domains/risk";

const TEST_USER_ID = "clrt_cycle_buyer_0001";
const TEST_SELLER_ID = "clrt_cycle_seller_0001";
const TEST_PRODUCT_ID = "clrt_cycle_product_0001";

async function seedFixture() {
  // Clean leftover carts/order groups from previous runs so the idempotency
  // key and getOrCreateCart start from a known state (test isolation).
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.orderGroup.deleteMany({
    where: { idempotencyKey: { in: ["cycle-test-1", "cycle-declared-1", "cycle-declared-2"] } },
  });

  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      email: "cycle-buyer@example.com",
      passwordHash: "x",
      role: "BUYER",
    },
    update: {},
  });
  const seller = await prisma.sellerProfile.upsert({
    where: { id: TEST_SELLER_ID },
    create: {
      id: TEST_SELLER_ID,
      userId: TEST_USER_ID,
      displayName: "Тестовый продавец",
      slug: "cycle-seller",
      identityStatus: "VERIFIED",
      businessStatus: "VERIFIED",
      isActivated: true,
    },
    update: {},
  });
  const category = await prisma.category.upsert({
    where: { slug: "test-cat" },
    create: { slug: "test-cat", name: "Тест" },
    update: {},
  });
  await prisma.product.upsert({
    where: { id: TEST_PRODUCT_ID },
    create: {
      id: TEST_PRODUCT_ID,
      sellerId: seller.id,
      title: "Тестовый товар для цикла заказа",
      sku: "CYCLE-TEST-001",
      seoSlug: "cycle-product",
      priceKopecks: 500000,
      currency: "RUB",
      status: "ACTIVE",
      categoryId: category.id,
    },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { productId: TEST_PRODUCT_ID },
    create: {
      productId: TEST_PRODUCT_ID,
      quantity: 10,
      availability: "AVAILABLE",
      confirmedBySeller: true,
      confirmedAt: new Date(),
    },
    update: {
      quantity: 10,
      availability: "AVAILABLE",
      confirmedBySeller: true,
      confirmedAt: new Date(),
    },
  });
}

/**
 * Builds a fresh standalone order for a shipment test. Shipments are 1:1 per
 * order, so tests that exercise createShipment need their own order rather
 * than reusing the shared lifecycle order.
 */
async function createFreshOrder(idempotencyKey: string) {
  // getOrCreateCart returns any existing cart for the user, so clear stale
  // carts first to guarantee the item we add is the one that gets checked out.
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({ where: { userId: TEST_USER_ID } });
  const cart = await prisma.cart.create({ data: { userId: TEST_USER_ID } });
  await prisma.cartItem.create({
    data: { cartId: cart.id, productId: TEST_PRODUCT_ID, quantity: 1, priceKopecks: 500000 },
  });
  const created = await createOrdersFromCart({
    buyerId: TEST_USER_ID,
    idempotencyKey,
    deliveryAddress: { city: "Москва" },
  });
  return prisma.order.findUniqueOrThrow({ where: { id: created.orders[0].id } });
}

describe("order lifecycle (release gate)", () => {
  let createdOrderIds: string[] = [];
  let createdGroupId = "";

  beforeAll(async () => {
    await seedFixture();
  });

  it("creates an order group from a cart", async () => {
    const cart = await prisma.cart.create({
      data: { userId: TEST_USER_ID },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: TEST_PRODUCT_ID,
        quantity: 2,
        priceKopecks: 500000,
      },
    });
    const view = await getCartView(TEST_USER_ID);
    expect(view.lines.length).toBe(1);

    const created = await createOrdersFromCart({
      buyerId: TEST_USER_ID,
      idempotencyKey: "cycle-test-1",
      deliveryAddress: { city: "Москва" },
    });

    expect(created.orders.length).toBe(1);
    expect(created.orders[0].totalKopecks).toBe(1_000_000);
    createdOrderIds = created.orders.map((o) => o.id);
    createdGroupId = created.groupId;

    // Every order must enter the payment state immediately (spec §124).
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: createdOrderIds[0] } });
    expect(stored.status).toBe("PAYMENT_PENDING");

    // Idempotency: the same key must not create a second group.
    const replay = await createOrdersFromCart({
      buyerId: TEST_USER_ID,
      idempotencyKey: "cycle-test-1",
      deliveryAddress: { city: "Москва" },
    });
    expect(replay.groupId).toBe(created.groupId);
  });

  it("captures payment and marks the order paid", async () => {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrderIds[0] },
    });
    expect(order.status).toBe("PAYMENT_PENDING");

    const result = await capturePayment(order.id);
    expect(result.status).toBe("SUCCEEDED");
    // The sandbox provider must be honestly labelled.
    expect(result.sandbox).toBe(true);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");

    // Repeated capture is idempotent — no second charge, no state change.
    const again = await capturePayment(order.id);
    expect(again.status).toBe("SUCCEEDED");
  });

  it("creates a settlement row on payment", async () => {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrderIds[0] },
      include: { settlements: true },
    });
    expect(order.settlements.length).toBe(1);
    const settlement = order.settlements[0];
    expect(settlement.status).toBe("PENDING");
    // 1.5% platform fee on 1_000_000 = 15_000 kopecks.
    expect(settlement.platformFeeKopecks).toBe(15_000);
  });

  it("runs a risk assessment on the order group", async () => {
    const verdict = await evaluateOrderRisk(createdGroupId);
    expect(["LOW", "MEDIUM", "HIGH", "REVIEW", "BLOCKED"]).toContain(verdict.level);
    expect(verdict.explanation).toBeTruthy();
  });

  it("lets the seller confirm and ship a paid order", async () => {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrderIds[0] },
    });

    const confirmed = await transitionOrder({
      orderId: order.id,
      to: "CONFIRMED",
      note: "seller confirmed",
      actorId: TEST_USER_ID,
      actorRole: "seller",
      actingUserId: TEST_USER_ID,
    });
    expect(confirmed.ok).toBe(true);

    const shipment = await createShipment({
      orderId: order.id,
      sellerProfileId: TEST_SELLER_ID,
      carrier: "sandbox-carrier",
    });
    expect(shipment.trackingNumber).toBeTruthy();
    expect(shipment.sandbox).toBe(true);

    // Tracking must reflect the carrier, not an invented status.
    const synced = await syncTracking(shipment.id);
    expect(synced.events.length).toBeGreaterThan(0);
  });

  it("preserves a seller-provided tracking number and never fabricates events", async () => {
    const order = await createFreshOrder("cycle-declared-1");

    // The seller names a real carrier and supplies the tracking number they
    // received from it. The platform has no adapter for this carrier yet.
    const shipment = await createShipment({
      orderId: order.id,
      sellerProfileId: TEST_SELLER_ID,
      carrier: "CDEK",
      trackingNumber: "CDEK-REAL-12345",
      deliveryKopecks: 25000,
    });
    expect(shipment.trackingNumber).toBe("CDEK-REAL-12345");
    expect(shipment.carrierName).toBe("CDEK");
    expect(shipment.sandbox).toBe(false);

    // Sync must return the seller-declared timeline verbatim — no invented
    // carrier events (spec §49: no fake delivery tracking as real).
    const synced = await syncTracking(shipment.id);
    expect(synced.trackingNumber).toBe("CDEK-REAL-12345");
    const invented = synced.events.filter((e) => /IN_TRANSIT|DELIVERED/.test(e.status));
    expect(invented).toHaveLength(0);
  });

  it("rejects an unknown carrier when no tracking number is supplied", async () => {
    const order = await createFreshOrder("cycle-declared-2");
    await expect(
      createShipment({
        orderId: order.id,
        sellerProfileId: TEST_SELLER_ID,
        carrier: "unknown-carrier-co",
      }),
    ).rejects.toThrow(/PENDING_EXTERNAL_ACCESS/);
  });

  it("lists the order in buyer history", async () => {
    const history = await getOrdersForBuyer(TEST_USER_ID);
    expect(history.length).toBeGreaterThan(0);
    const paid = history.find((o) => o.status !== "PAYMENT_PENDING");
    expect(paid).toBeDefined();
  });

  it("resolves a payment provider without exposing secrets", async () => {
    const provider = getPaymentProvider();
    expect(provider.key).toBeTruthy();
    // A provider must never be silently considered production-ready.
    expect(typeof provider.sandbox).toBe("boolean");
  });

  it("consolidates pending settlements into one payout (spec §26)", async () => {
    // The lifecycle order above was paid, so its settlement is PENDING.
    const before = await prisma.settlement.findMany({
      where: { sellerId: TEST_SELLER_ID, status: "PENDING" },
    });
    expect(before.length).toBeGreaterThan(0);

    const result = await createConsolidatedPayout({
      sellerId: TEST_SELLER_ID,
      actorId: TEST_USER_ID,
      idempotencyKey: "payout-test-1",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.settledCount).toBe(before.length);
    // The sandbox payout provider must be labelled as such (spec §49).
    expect(result.sandbox).toBe(true);
    expect(result.amountKopecks).toBe(
      before.reduce((sum, s) => sum + s.payoutKopecks, 0),
    );

    // Every settled row is now linked to the payout and fully paid out.
    const after = await prisma.settlement.findMany({
      where: { sellerId: TEST_SELLER_ID, payoutId: result.payoutId },
    });
    expect(after.length).toBe(before.length);
    expect(after.every((s) => s.status === "PAID")).toBe(true);
  });

  it("makes a retried payout idempotent (spec §125)", async () => {
    const first = await createConsolidatedPayout({
      sellerId: TEST_SELLER_ID,
      actorId: TEST_USER_ID,
      idempotencyKey: "payout-test-2",
    });
    expect(first.status).toBe("NOTHING_TO_PAYOUT");

    // Replaying the same key must not create a second disbursement.
    const second = await createConsolidatedPayout({
      sellerId: TEST_SELLER_ID,
      actorId: TEST_USER_ID,
      idempotencyKey: "payout-test-1",
    });
    const original = await prisma.payout.findUniqueOrThrow({
      where: { idempotencyKey: "payout-test-1" },
    });
    expect(second.payoutId).toBe(original.id);
    expect(second.status).toBe("SUCCEEDED");
  });

  it("records the payout in an auditable trail", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { action: "PAYOUT_REQUESTED", actorId: TEST_USER_ID },
    });
    expect(logs.length).toBeGreaterThan(0);
    const parsed = JSON.parse(logs[logs.length - 1].after ?? "{}");
    expect(parsed.amountKopecks).toBeGreaterThan(0);
    expect(parsed.sandbox).toBe(true);
  });

  it("produces a seller settlement statement with all fee lines", async () => {
    const statement = await sellerSettlementStatement(TEST_SELLER_ID);
    expect(statement.settlements.length).toBeGreaterThan(0);
    const s = statement.settlements[0];
    // Platform commission must be separate from payment processing (spec §26).
    expect(s.platformFeeKopecks).toBeGreaterThan(0);
    expect(statement.totals.payoutKopecks).toBeGreaterThan(0);
  });

  it("charges the price-at-add snapshot, not a later seller price rise", async () => {
    // A seller raising the price after the buyer added the item must never
    // silently increase what the buyer pays (P0 fix, spec §9).
    await prisma.inventory.update({
      where: { productId: TEST_PRODUCT_ID },
      data: { quantity: 5 },
    });
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({ where: { userId: TEST_USER_ID } });
    const cart = await prisma.cart.create({ data: { userId: TEST_USER_ID } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: TEST_PRODUCT_ID, quantity: 1, priceKopecks: 500000 },
    });

    // Seller doubles the price while the item sits in the cart.
    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: { priceKopecks: 1_000_000 },
    });

    const view = await getCartView(TEST_USER_ID);
    const line = view.lines[0];
    expect(line.priceChanged).toBe(true);
    // The buyer keeps the price they agreed to at add time.
    expect(line.priceKopecks).toBe(500_000);
    expect(line.lineTotalKopecks).toBe(500_000);

    const created = await createOrdersFromCart({
      buyerId: TEST_USER_ID,
      idempotencyKey: "price-snapshot-1",
      deliveryAddress: { city: "Москва" },
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: created.orders[0].id },
      include: { items: true },
    });
    expect(order.totalKopecks).toBe(500_000);
    expect(order.items[0].priceKopecks).toBe(500_000);

    // Restore the fixture price for later tests.
    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: { priceKopecks: 500000 },
    });
  });

  it("gives the buyer a lower price when the seller drops it", async () => {
    await prisma.inventory.update({
      where: { productId: TEST_PRODUCT_ID },
      data: { quantity: 5 },
    });
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({ where: { userId: TEST_USER_ID } });
    const cart = await prisma.cart.create({ data: { userId: TEST_USER_ID } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: TEST_PRODUCT_ID, quantity: 1, priceKopecks: 500000 },
    });
    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: { priceKopecks: 300_000 },
    });

    const view = await getCartView(TEST_USER_ID);
    expect(view.lines[0].priceKopecks).toBe(300_000);

    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: { priceKopecks: 500000 },
    });
  });

  it("atomically reserves stock at checkout, so the last item cannot be oversold", async () => {
    // Two buyers race for the single remaining unit. The pre-transaction read
    // would let both through; the conditional decrement must not.
    await prisma.inventory.update({
      where: { productId: TEST_PRODUCT_ID },
      data: { quantity: 1 },
    });
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});

    const carts = await Promise.all([
      prisma.cart.create({ data: { userId: TEST_USER_ID } }),
      prisma.cart.create({ data: { userId: TEST_USER_ID } }),
    ]);
    await Promise.all(
      carts.map((c) =>
        prisma.cartItem.create({
          data: { cartId: c.id, productId: TEST_PRODUCT_ID, quantity: 1, priceKopecks: 500000 },
        })
      )
    );

    const results = await Promise.allSettled([
      createOrdersFromCart({
        buyerId: TEST_USER_ID,
        idempotencyKey: "race-a",
        deliveryAddress: { city: "Москва" },
      }),
      createOrdersFromCart({
        buyerId: TEST_USER_ID,
        idempotencyKey: "race-b",
        deliveryAddress: { city: "Москва" },
      }),
    ]);
    const settled = results.filter((r) => r.status === "fulfilled");
    // Exactly one buyer wins the unit; the other is rejected with an honest
    // message rather than sold an item that does not exist.
    expect(settled).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(String((rejected as PromiseRejectedResult).reason)).toMatch(/закончилась/);

    const after = await prisma.inventory.findUniqueOrThrow({ where: { productId: TEST_PRODUCT_ID } });
    expect(after.quantity).toBe(0);
  });

  it("returns reserved stock to inventory exactly once when an order is cancelled", async () => {
    await prisma.inventory.update({
      where: { productId: TEST_PRODUCT_ID },
      data: { quantity: 2 },
    });
    const order = await createFreshOrder("cancel-refund-1");
    // Checkout claimed one unit.
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: TEST_PRODUCT_ID } })).quantity
    ).toBe(1);

    await transitionOrder({
      orderId: order.id,
      to: "CANCELLED",
      actorId: TEST_USER_ID,
      actorRole: "buyer",
      actingUserId: TEST_USER_ID,
    });
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: TEST_PRODUCT_ID } })).quantity
    ).toBe(2);

    // Re-cancelling is a no-op, never a second stock credit.
    const again = await transitionOrder({
      orderId: order.id,
      to: "CANCELLED",
      actorId: TEST_USER_ID,
      actorRole: "buyer",
      actingUserId: TEST_USER_ID,
    });
    expect(again.ok).toBe(true);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: TEST_PRODUCT_ID } })).quantity
    ).toBe(2);
  });
});
