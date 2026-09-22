/**
 * Reviews + buyer collections + public seller profile (spec §5, §14, §28, §61).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { createReview, listReviews, summarizeReviews } from "../src/lib/domains/reviews";
import {
  addFavorite,
  removeFavorite,
  listFavorites,
  getOrCreateWishlist,
  addWishlistItem,
  listWishlistItems,
  removeWishlistItem,
} from "../src/lib/domains/collections";
import { getPublicSellerProfile, listSellerProducts } from "../src/lib/domains/sellers";
import { hashPassword } from "../src/lib/auth";

const SELLER_EMAIL = `rev-seller@${process.env.VITEST_WORKER_ID ?? "0"}.test`;
const BUYER_EMAIL = `rev-buyer@${process.env.VITEST_WORKER_ID ?? "0"}.test`;

let sellerUserId = "";
let sellerId = "";
let buyerId = "";
let productId = "";
let deliveredOrderId = "";

beforeAll(async () => {
  const sellerUser = await prisma.user.upsert({
    where: { email: SELLER_EMAIL },
    create: { email: SELLER_EMAIL, name: "Отзывный продавец", role: "SELLER", passwordHash: await hashPassword("password123") },
    update: {},
  });
  sellerUserId = sellerUser.id;
  const seller = await prisma.sellerProfile.upsert({
    where: { slug: "review-seller" },
    create: { userId: sellerUser.id, slug: "review-seller", displayName: "Отзывный продавец", isActivated: true },
    update: { isActivated: true },
  });
  sellerId = seller.id;

  const buyer = await prisma.user.upsert({
    where: { email: BUYER_EMAIL },
    create: { email: BUYER_EMAIL, name: "Отзывный покупатель", role: "BUYER", passwordHash: await hashPassword("password123") },
    update: {},
  });
  buyerId = buyer.id;

  const product = await prisma.product.upsert({
    where: { sku: "REV-001" },
    create: {
      sellerId,
      sku: "REV-001",
      title: "Товар для отзывов",
      priceKopecks: 500000,
      status: "ACTIVE",
      inventory: { create: { quantity: 10, availability: "AVAILABLE" } },
    },
    update: { status: "ACTIVE" },
  });
  productId = product.id;

  const order = await prisma.order.create({
    data: {
      buyerId,
      sellerId,
      number: "REV-ORD-1",
      status: "DELIVERED",
      totalKopecks: 500000,
      items: { create: [{ productId, quantity: 1, priceKopecks: 500000, titleSnapshot: "Товар для отзывов" }] },
    },
  });
  deliveredOrderId = order.id;
});

describe("reviews", () => {
  it("creates a verified-purchase review from a delivered order", async () => {
    const r = await createReview({
      authorId: buyerId,
      productId,
      orderId: deliveredOrderId,
      rating: 5,
      body: "Отличный товар, всё пришло вовремя и хорошо упаковано.",
    });
    expect(r.id).toBeTruthy();
    expect(r.verifiedPurchase).toBe(true);
  });

  it("rejects a duplicate review for the same order", async () => {
    await expect(
      createReview({
        authorId: buyerId,
        productId,
        orderId: deliveredOrderId,
        rating: 4,
        body: "Повторный отзыв к тому же заказу.",
      })
    ).rejects.toThrow();
  });

  it("rejects out-of-range ratings and short bodies", async () => {
    await expect(
      createReview({ authorId: buyerId, productId, rating: 9, body: "Норм" })
    ).rejects.toThrow();
    await expect(
      createReview({ authorId: buyerId, productId, rating: 3, body: "коротко" })
    ).rejects.toThrow();
  });

  it("leaves unverified when the buyer never bought the product", async () => {
    const other = await prisma.user.create({
      data: { email: `nobody@${process.env.VITEST_WORKER_ID ?? "0"}.test`, name: "Без покупки", role: "BUYER", passwordHash: "x" },
    });
    const r = await createReview({
      authorId: other.id,
      productId,
      rating: 2,
      body: "Я этот товар не покупал, просто пишу отзыв.",
    });
    expect(r.verifiedPurchase).toBe(false);
  });

  it("lists reviews and summarises them without faking sentiment", async () => {
    const items = await listReviews(productId);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const s = await summarizeReviews(productId);
    expect(s.count).toBeGreaterThanOrEqual(1);
    expect(s.sentimentBasis).toMatch(/rating-derived|live-model|not-proven/);
  });
});

describe("collections", () => {
  it("adds and removes a favorite", async () => {
    await addFavorite(buyerId, productId);
    let favs = await listFavorites(buyerId);
    expect(favs.some((f) => f.id === productId)).toBe(true);
    await removeFavorite(buyerId, productId);
    favs = await listFavorites(buyerId);
    expect(favs.some((f) => f.id === productId)).toBe(false);
  });

  it("creates a default wishlist and manages items idempotently", async () => {
    const list = await getOrCreateWishlist(buyerId);
    expect(list.id).toBeTruthy();
    const again = await getOrCreateWishlist(buyerId);
    expect(again.id).toBe(list.id);

    await addWishlistItem(list.id, buyerId, productId, "подарок маме");
    await addWishlistItem(list.id, buyerId, productId); // idempotent
    const items = await listWishlistItems(list.id, buyerId);
    expect(items.filter((i) => i.id === productId)).toHaveLength(1);

    await removeWishlistItem(list.id, buyerId, productId);
    const after = await listWishlistItems(list.id, buyerId);
    expect(after.filter((i) => i.id === productId)).toHaveLength(0);
  });
});

describe("public seller profile", () => {
  it("exposes verification status but never raw INN/bank details", async () => {
    const profile = await getPublicSellerProfile(sellerId);
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe("Отзывный продавец");
    expect(profile!.stats.productsPublished).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(profile!)).not.toContain("bankAccountMasked");

    const bySlug = await getPublicSellerProfile("review-seller");
    expect(bySlug!.id).toBe(sellerId);
  });

  it("lists public products with resolved availability", async () => {
    const products = await listSellerProducts(sellerId);
    expect(products.some((p) => p.id === productId)).toBe(true);
    const target = products.find((p) => p.id === productId)!;
    expect(target.priceRub).toBe(5000);
    expect(target.availability).toBe("AVAILABLE");
  });

  it("returns null for an inactive seller", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: `inactive@${process.env.VITEST_WORKER_ID ?? "0"}.test`,
        name: "Неактивный продавец",
        role: "SELLER",
        passwordHash: "x",
      },
    });
    const inactive = await prisma.sellerProfile.create({
      data: { userId: otherUser.id, slug: "inactive-seller", displayName: "Неактивный", isActivated: false },
    });
    expect(await getPublicSellerProfile(inactive.id)).toBeNull();
  });
});
