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
    rating: number;
    reviewsCount: number;
    completedOrders: number;
  };
  trustSignals: Record<string, unknown>;
}

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
        select: { id: true, rating: true, reviewsCount: true },
      },
    },
  });
  if (!seller) return null;

  const rated = seller.products.filter((p) => p.reviewsCount > 0);
  const rating =
    rated.length > 0
      ? Math.round((rated.reduce((s, p) => s + p.rating, 0) / rated.length) * 10) / 10
      : 0;
  const reviewsCount = seller.products.reduce((s, p) => s + p.reviewsCount, 0);

  let trustSignals: Record<string, unknown> = {};
  try {
    trustSignals = JSON.parse(seller.trustSignals ?? "{}") as Record<string, unknown>;
  } catch {
    trustSignals = {};
  }

  const completedOrders = await prisma.order.count({
    where: { sellerId: seller.id, status: { in: ["DELIVERED", "COMPLETED"] } },
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
      rating,
      reviewsCount,
      completedOrders,
    },
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
