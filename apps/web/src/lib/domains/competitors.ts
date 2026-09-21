/**
 * Competitor Intelligence (spec §13, §26).
 *
 * Uses ONLY public marketplace data and the seller's own catalog. There is no
 * access to other sellers' private cabinets, no scraping of closed data, and
 * no automatic copying of protected content (spec §13).
 */
import { prisma } from "../prisma";
import { fromKopecks } from "../utils";

export interface CompetitorOffer {
  id: string;
  sellerName: string;
  sellerUrl: string | null;
  priceKopecks: number;
  currency: string;
  rating: number | null;
  reviewsCount: number | null;
  notes: string | null;
  observedAt: Date;
  deltaKopecks: number;
}

export interface CompetitorReport {
  productId: string;
  ownTitle: string;
  ownPriceKopecks: number;
  ownRating: number;
  offers: CompetitorOffer[];
  cheaperCount: number;
  minCompetitorPrice: number | null;
  gaps: string[];
}

export async function findCompetitors(productId: string): Promise<CompetitorReport> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { sellerProfile: true, images: true },
  });
  if (!product) throw new Error("товар не найден");

  const rows = await prisma.competitorListing.findMany({
    where: { productId },
    orderBy: { priceKopecks: "asc" },
  });

  const offers: CompetitorOffer[] = rows.map((r) => ({
    id: r.id,
    sellerName: r.sellerName,
    sellerUrl: r.sellerUrl,
    priceKopecks: r.priceKopecks,
    currency: r.currency,
    rating: r.rating,
    reviewsCount: r.reviewsCount,
    notes: r.notes,
    observedAt: r.observedAt,
    deltaKopecks: r.priceKopecks - product.priceKopecks,
  }));

  const cheaper = offers.filter((o) => o.deltaKopecks < 0);
  const minPrice = offers.length ? offers[0].priceKopecks : null;

  const gaps: string[] = [];
  if (product.images.length === 0) gaps.push("у вашей карточки нет фотографий");
  if (!product.description || product.description.length < 100) {
    gaps.push("короткое описание — конкуренты описывают товар подробнее");
  }
  if (product.reviewsCount === 0) gaps.push("нет отзывов — карточка выглядит новой для покупателя");
  if (minPrice !== null && product.priceKopecks > minPrice) {
    gaps.push(
      `есть ${cheaper.length} предложений дешевле вашего (минимум ${fromKopecks(minPrice)} ₽)`
    );
  }

  return {
    productId,
    ownTitle: product.title,
    ownPriceKopecks: product.priceKopecks,
    ownRating: product.rating,
    offers,
    cheaperCount: cheaper.length,
    minCompetitorPrice: minPrice,
    gaps,
  };
}

/**
 * Catalog-wide competitors: other active sellers in the same category.
 * Public listing data only.
 */
export async function findCompetitorSellers(sellerId: string, limit = 20) {
  const myProducts = await prisma.product.findMany({
    where: { sellerId, status: "ACTIVE" },
    select: { categoryId: true },
  });
  const categoryIds = [...new Set(myProducts.map((p) => p.categoryId).filter(Boolean))] as string[];
  if (categoryIds.length === 0) return [];

  const rows = await prisma.product.findMany({
    where: { status: "ACTIVE", sellerId: { not: sellerId }, categoryId: { in: categoryIds } },
    include: { sellerProfile: { select: { displayName: true, identityStatus: true, businessStatus: true } } },
    take: Math.min(limit * 4, 200),
  });

  const bySeller = new Map<string, { displayName: string; verificationStatus: string; products: number; minPrice: number }>();
  for (const r of rows) {
    const sp = r.sellerProfile;
    if (!sp) continue;
    const entry = bySeller.get(r.sellerId) ?? {
      displayName: sp.displayName,
      verificationStatus: sp.businessStatus || sp.identityStatus,
      products: 0,
      minPrice: Number.POSITIVE_INFINITY,
    };
    entry.products += 1;
    entry.minPrice = Math.min(entry.minPrice, r.priceKopecks);
    bySeller.set(r.sellerId, entry);
  }
  return [...bySeller.entries()]
    .map(([id, v]) => ({
      sellerId: id,
      displayName: v.displayName,
      verificationStatus: v.verificationStatus,
      products: v.products,
      minPrice: v.minPrice === Number.POSITIVE_INFINITY ? null : v.minPrice,
    }))
    .sort((a, b) => b.products - a.products)
    .slice(0, limit);
}

export interface RecordCompetitorInput {
  productId: string;
  sellerName: string;
  sellerUrl?: string;
  priceKopecks: number;
  currency?: string;
  rating?: number;
  reviewsCount?: number;
  notes?: string;
}

export async function recordCompetitorOffer(input: RecordCompetitorInput) {
  return prisma.competitorListing.create({
    data: {
      productId: input.productId,
      sellerName: input.sellerName.slice(0, 200),
      sellerUrl: input.sellerUrl,
      priceKopecks: input.priceKopecks,
      currency: input.currency ?? "RUB",
      rating: input.rating,
      reviewsCount: input.reviewsCount,
      notes: input.notes,
    },
  });
}
