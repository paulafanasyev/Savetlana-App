/**
 * Buyer collections: favorites and wishlists (spec §5, §15, §29).
 *
 * Favorites are a flat per-user product set. Wishlists are named, private by
 * default, and can be shared. Both record consent-aware events that feed the
 * recommendation engine — never silently, and never for a user other than the
 * caller.
 */
import { prisma } from "../prisma";
import { recordEvent } from "./events";
import { fromKopecks } from "../utils";

export interface CollectionProduct {
  id: string;
  title: string;
  seoSlug: string | null;
  sku: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  rating: number;
  reviewsCount: number;
  availability: string;
  imageUrl: string | null;
  sellerName: string;
  sellerId: string;
}

function mapProduct(p: {
  id: string;
  title: string;
  seoSlug: string | null;
  sku: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  rating: number;
  reviewsCount: number;
  images: { url: string }[];
  inventory: { availability: string } | null;
  sellerProfile: { displayName: string; id: string } | null;
}): CollectionProduct {
  return {
    id: p.id,
    title: p.title,
    seoSlug: p.seoSlug,
    sku: p.sku,
    priceKopecks: p.priceKopecks,
    oldPriceKopecks: p.oldPriceKopecks,
    rating: p.rating,
    reviewsCount: p.reviewsCount,
    availability: p.inventory?.availability ?? "UNKNOWN",
    imageUrl: p.images[0]?.url ?? null,
    sellerName: p.sellerProfile?.displayName ?? "—",
    sellerId: p.sellerProfile?.id ?? "",
  };
}

const PRODUCT_SELECT = {
  id: true,
  title: true,
  seoSlug: true,
  sku: true,
  priceKopecks: true,
  oldPriceKopecks: true,
  rating: true,
  reviewsCount: true,
  images: { orderBy: { createdAt: "asc" }, take: 1, select: { url: true } },
  inventory: { select: { availability: true } },
  sellerProfile: { select: { displayName: true, id: true } },
} as const;

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function listFavorites(userId: string): Promise<CollectionProduct[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { product: { select: PRODUCT_SELECT } },
  });
  return rows.map((r) => mapProduct(r.product)).filter((p) => p.sellerId !== "");
}

export async function addFavorite(userId: string, productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Товар не найден");
  await prisma.favorite.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
  await recordEvent({ type: "favorite_add", userId, productId });
}

export async function removeFavorite(userId: string, productId: string): Promise<void> {
  await prisma.favorite.deleteMany({ where: { userId, productId } });
  await recordEvent({ type: "favorite_remove", userId, productId });
}

// ---------------------------------------------------------------------------
// Wishlists
// ---------------------------------------------------------------------------

export async function getOrCreateWishlist(
  userId: string,
  name = "Избранное"
): Promise<{ id: string; name: string; isPrivate: boolean }> {
  const existing = await prisma.wishlist.findFirst({ where: { userId, name } });
  if (existing) return { id: existing.id, name: existing.name, isPrivate: existing.isPrivate };
  const created = await prisma.wishlist.create({ data: { userId, name, isPrivate: true } });
  return { id: created.id, name: created.name, isPrivate: created.isPrivate };
}

export async function listWishlists(userId: string) {
  const lists = await prisma.wishlist.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return lists.map((l) => ({ id: l.id, name: l.name, isPrivate: l.isPrivate, itemsCount: l._count.items }));
}

export async function listWishlistItems(wishlistId: string, userId: string): Promise<CollectionProduct[]> {
  const rows = await prisma.wishlistItem.findMany({
    where: { wishlistId, userId },
    orderBy: { createdAt: "desc" },
    include: { product: { select: PRODUCT_SELECT } },
  });
  return rows.map((r) => mapProduct(r.product)).filter((p) => p.sellerId !== "");
}

export async function addWishlistItem(
  wishlistId: string,
  userId: string,
  productId: string,
  note?: string
): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Товар не найден");
  await prisma.wishlistItem.upsert({
    where: { wishlistId_productId: { wishlistId, productId } },
    create: { wishlistId, userId, productId, note: note?.trim() || null },
    update: { note: note?.trim() || undefined },
  });
  await recordEvent({ type: "wishlist_add", userId, productId, payload: { wishlistId } });
}

export async function removeWishlistItem(wishlistId: string, userId: string, productId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { wishlistId, userId, productId } });
  await recordEvent({ type: "wishlist_remove", userId, productId, payload: { wishlistId } });
}

export { fromKopecks };
