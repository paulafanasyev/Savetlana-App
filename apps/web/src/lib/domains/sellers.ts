/**
 * Public seller profile (spec §61).
 *
 * Only information a seller may legitimately show in public: display name,
 * type, description, verification *status* (never raw document numbers),
 * aggregated history and public products. INN/OGRN/bank details are never
 * exposed here — verification status is a signal, not the document.
 */
import { prisma } from "../prisma";
import { fromKopecks } from "../utils";
import { computeSellerRating, sellerBadges, type SellerBadge, type SellerRating } from "./seller-trust-display";

export interface PublicSellerProfile {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  sellerType: string;
  identityStatus: string;
  businessStatus: string;
  npdStatus: string;
  isActivated: boolean;
  createdAt: string;
  stats: {
    productsPublished: number;
    /** Рейтинг продавца 1–5 с поправкой на малое число отзывов (0, если отзывов нет). */
    rating: number;
    /** Простое среднее по отзывам. */
    averageRating: number;
    reviewsCount: number;
    completedOrders: number;
    /** Доля успешных сделок 0–1 или null, если заказов мало. */
    successRate: number | null;
    level: SellerRating["level"];
    levelLabel: string;
  };
  badges: SellerBadge[];
  trustSignals: Record<string, unknown>;
}

const PAID_PAYMENT_STATUSES = ["AUTHORIZED", "CAPTURED", "SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"];

export async function getPublicSellerProfile(
  idOrSlug: string
): Promise<PublicSellerProfile | null> {
  const seller = await prisma.sellerProfile.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      isActivated: true,
    },
    include: {
      products: {
        where: { status: "ACTIVE" },
        select: { id: true },
      },
    },
  });
  if (!seller) return null;

  let trustSignals: Record<string, unknown> = {};
  try {
    trustSignals = JSON.parse(seller.trustSignals ?? "{}") as Record<string, unknown>;
  } catch {
    trustSignals = {};
  }

  // Рейтинг только по фактам: видимые отзывы на товары продавца и итоги заказов.
  const [reviewGroups, completedOrders, cancelledAfterPayment, refundedOrders, disputedOrders] = await Promise.all([
    prisma.review.groupBy({
      by: ["verifiedPurchase"],
      where: { isHidden: false, product: { sellerId: seller.id } },
      _sum: { rating: true },
      _count: { _all: true },
    }),
    prisma.order.count({ where: { sellerId: seller.id, status: { in: ["DELIVERED", "COMPLETED"] } } }),
    prisma.order.count({
      where: { sellerId: seller.id, status: "CANCELLED", payment: { is: { status: { in: PAID_PAYMENT_STATUSES } } } },
    }),
    prisma.order.count({ where: { sellerId: seller.id, status: "REFUNDED" } }),
    prisma.order.count({ where: { sellerId: seller.id, status: "DISPUTED" } }),
  ]);
  const verified = reviewGroups.find((g) => g.verifiedPurchase);
  const other = reviewGroups.find((g) => !g.verifiedPurchase);
  const rating = computeSellerRating({
    verifiedSum: verified?._sum.rating ?? 0,
    verifiedCount: verified?._count._all ?? 0,
    otherSum: other?._sum.rating ?? 0,
    otherCount: other?._count._all ?? 0,
    completedOrders,
    cancelledAfterPayment,
    refundedOrders,
    disputedOrders,
  });

  return {
    id: seller.id,
    slug: seller.slug,
    displayName: seller.displayName,
    description: seller.description,
    logoUrl: seller.logoUrl,
    sellerType: seller.sellerType,
    identityStatus: seller.identityStatus,
    businessStatus: seller.businessStatus,
    npdStatus: seller.npdStatus,
    isActivated: seller.isActivated,
    createdAt: seller.createdAt.toISOString(),
    stats: {
      productsPublished: seller.products.length,
      rating: rating.score,
      averageRating: rating.average,
      reviewsCount: rating.reviewsCount,
      completedOrders,
      successRate: rating.successRate,
      level: rating.level,
      levelLabel: rating.levelLabel,
    },
    badges: sellerBadges(seller),
    trustSignals,
  };
}

const PRODUCT_PUBLIC_SELECT = {
  id: true,
  title: true,
  seoSlug: true,
  sku: true,
  priceKopecks: true,
  oldPriceKopecks: true,
  rating: true,
  reviewsCount: true,
  ordersCount: true,
  createdAt: true,
  images: { orderBy: { createdAt: "asc" }, take: 1 },
  inventory: { select: { quantity: true, availability: true, confirmedAt: true } },
} as const;

export interface PublicProductCard {
  id: string;
  title: string;
  seoSlug: string | null;
  sku: string;
  priceKopecks: number;
  priceRub: number;
  oldPriceKopecks: number | null;
  rating: number;
  reviewsCount: number;
  availability: string;
  imageUrl: string | null;
}

export async function listSellerProducts(sellerId: string, limit = 24): Promise<PublicProductCard[]> {
  const products = await prisma.product.findMany({
    where: { sellerId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: PRODUCT_PUBLIC_SELECT,
  });
  return products.map((p) => ({
    id: p.id,
    title: p.title,
    seoSlug: p.seoSlug,
    sku: p.sku,
    priceKopecks: p.priceKopecks,
    priceRub: fromKopecks(p.priceKopecks),
    oldPriceKopecks: p.oldPriceKopecks,
    rating: p.rating,
    reviewsCount: p.reviewsCount,
    availability: p.inventory?.availability ?? "UNKNOWN",
    imageUrl: p.images[0]?.url ?? null,
  }));
}

export { fromKopecks };
