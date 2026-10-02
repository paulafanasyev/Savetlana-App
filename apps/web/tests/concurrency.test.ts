/**
 * Concurrency safety for money and stock (audit §19, P0-6, spec §124).
 *
 * The sequential overselling test in `order-lifecycle.test.ts` proves the
 * conditional decrement rejects a second reservation, but it drives both
 * attempts through one buyer, whose cart is shared. That is not the scenario a
 * marketplace actually has to survive: two unrelated people, one unit left,
 * both press "buy" at the same instant.
 *
 * These tests therefore use genuinely separate buyers with separate carts and
 * fire the checkouts concurrently. SQLite serialises writers, so this proves
 * the invariant holds under real contention rather than proving nothing
 * happened.
 *
 * What must never be true:
 *   - stock goes negative
 *   - two buyers both walk away with the same unit
 *   - a buyer pays for a line that was never reserved
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { createOrdersFromCart } from "../src/lib/domains/orders";
import { capturePayment } from "../src/lib/domains/payments";

const SELLER_ID = "conc_seller_0001";
const PRODUCT_ID = "conc_product_0001";
const BUYERS = ["conc_buyer_a", "conc_buyer_b", "conc_buyer_c"] as const;

/**
 * Idempotency keys are unique per test. `createOrdersFromCart` returns the
 * original order group for a replayed key instead of checking out again, so
 * reusing a key across tests would silently pass cached results rather than
 * exercising the race.
 */
const keysFor = (test: string) => [`${test}-a`, `${test}-b`, `${test}-c`] as const;

async function seed() {
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.orderGroup.deleteMany({ where: { idempotencyKey: { startsWith: "conc-" } } });

  await prisma.user.upsert({
    where: { id: SELLER_ID },
    create: { id: SELLER_ID, email: "conc-seller@example.com", passwordHash: "x", role: "SELLER" },
    update: {},
  });
  const seller = await prisma.sellerProfile.upsert({
    where: { id: SELLER_ID },
    create: {
      id: SELLER_ID,
      userId: SELLER_ID,
      displayName: "Продавец гонки",
      slug: "conc-seller",
      identityStatus: "VERIFIED",
      businessStatus: "VERIFIED",
      isActivated: true,
    },
    update: {},
  });

  for (const id of BUYERS) {
    await prisma.user.upsert({
      where: { id },
      create: { id, email: `${id}@example.com`, passwordHash: "x", role: "BUYER" },
      update: {},
    });
  }

  const category = await prisma.category.upsert({
    where: { slug: "conc-cat" },
    create: { slug: "conc-cat", name: "Гонка" },
    update: {},
  });
  await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    create: {
      id: PRODUCT_ID,
      sellerId: seller.id,
      title: "Единственный экземпляр",
      sku: "CONC-001",
      seoSlug: "conc-product",
      priceKopecks: 750000,
      currency: "RUB",
      status: "ACTIVE",
      categoryId: category.id,
    },
    update: {},
  });
}

/** Puts `qty` units of the contested product in each buyer's own cart. */
async function stockUnits(qty: number) {
  await prisma.inventory.upsert({
    where: { productId: PRODUCT_ID },
    create: {
      productId: PRODUCT_ID,
      quantity: qty,
      availability: "AVAILABLE",
      confirmedBySeller: true,
      confirmedAt: new Date(),
    },
    update: {
      quantity: qty,
      availability: "AVAILABLE",
      confirmedBySeller: true,
      confirmedAt: new Date(),
    },
  });
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  for (const buyerId of BUYERS) {
    const cart = await prisma.cart.create({ data: { userId: buyerId } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: PRODUCT_ID, quantity: 1, priceKopecks: 750000 },
    });
  }
}

const checkoutFor = (buyerId: string, key: string) =>
  createOrdersFromCart({ buyerId, idempotencyKey: key, deliveryAddress: { city: "Москва" } });

describe("concurrent checkout against a scarce inventory", () => {
  beforeAll(async () => {
    await seed();
  });

  it("lets exactly one of three buyers win the last unit", async () => {
    await stockUnits(1);
    const keys = keysFor("conc-t1");

    const results = await Promise.allSettled([
      checkoutFor(BUYERS[0], keys[0]),
      checkoutFor(BUYERS[1], keys[1]),
      checkoutFor(BUYERS[2], keys[2]),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);

    const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(lost).toHaveLength(2);
    for (const r of lost) expect(String(r.reason)).toMatch(/закончилась/);

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: PRODUCT_ID } });
    expect(inv.quantity).toBe(0);
  });

  it("never lets stock fall below zero when demand exceeds supply", async () => {
    await stockUnits(2);
    const keys = keysFor("conc-t2");

    const results = await Promise.allSettled([
      checkoutFor(BUYERS[0], keys[0]),
      checkoutFor(BUYERS[1], keys[1]),
      checkoutFor(BUYERS[2], keys[2]),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(2);

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: PRODUCT_ID } });
    // The invariant that matters: no oversell, at any concurrency level.
    expect(inv.quantity).toBe(0);
    expect(inv.quantity).toBeGreaterThanOrEqual(0);
  });

  it("does not let a rejected buyer reach payment", async () => {
    await stockUnits(1);
    const keys = keysFor("conc-t3");

    const attempts = await Promise.allSettled([
      checkoutFor(BUYERS[0], keys[0]),
      checkoutFor(BUYERS[1], keys[1]),
    ]);

    const loserIndex = attempts.findIndex((r) => r.status === "rejected");
    const winnerIndex = loserIndex === 0 ? 1 : 0;
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // Scoped to this test's idempotency key — the same buyers already hold
    // orders created by the two earlier tests in this file.
    expect(await prisma.orderGroup.count({ where: { idempotencyKey: keys[loserIndex] } })).toBe(0);
    expect(
      await prisma.order.count({ where: { group: { idempotencyKey: keys[loserIndex] } } }),
    ).toBe(0);

    // The winner's order is payable and the sandbox charge is honestly labelled.
    const order = await prisma.order.findFirstOrThrow({
      where: { group: { idempotencyKey: keys[winnerIndex] } },
    });
    const charge = await capturePayment(order.id);
    expect(charge.status).toBe("SUCCEEDED");
    expect(charge.sandbox).toBe(true);

    // Capturing twice must not produce a second charge (spec §125).
    const again = await capturePayment(order.id);
    expect(again.status).toBe("SUCCEEDED");
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");
  });
});