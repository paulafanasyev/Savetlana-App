/**
 * Global product search + external competitor intelligence (spec §13, §26).
 *
 * Svetlana must find products and analyse competitors GLOBALLY — across Ozon
 * and Wildberries as well as this platform — and be able to create listings
 * and run a shop on request.
 *
 * Every external result is persisted with its own honest confidence. Offers
 * parsed from a live feed are stored as VERIFIED only when the price
 * plausibility guard passed; otherwise the batch is recorded as NOT_PROVEN
 * with the reason, never as silently wrong numbers (spec §49).
 */
import { prisma } from "../prisma";
import { fromKopecks } from "../utils";
import type {
  ExternalOffer,
  ExternalSearchQuery,
  ExternalSearchResult,
} from "../marketplaces/types";
import {
  getMarketplaceAvailability,
  searchMarketplaceTier,
  tierLabel,
  type ScanTier,
} from "../marketplaces";

export interface GlobalSearchHit {
  source: "platform" | "external";
  marketplace?: string;
  externalId?: string;
  title: string;
  url: string;
  priceKopecks: number;
  oldPriceKopecks?: number;
  rating?: number;
  reviewsCount?: number;
  sellerName?: string;
  brand?: string;
  imageUrl?: string;
  confidence: "VERIFIED" | "NOT_PROVEN";
}

export interface GlobalSearchReport {
  query: string;
  tier: ScanTier;
  tierLabel: string;
  hits: GlobalSearchHit[];
  bySource: { platform: number; external: number };
  /**
   * Pro-platform comparison. Present so the buyer always sees how the platform
   * fares against external marketplaces — never null when both sides answered.
   */
  platformAdvantage: {
    cheapestPlatform: number;
    cheapestExternal: number;
    platformIsCheapest: boolean;
    savingKopecks: number;
  } | null;
  warnings: string[];
  /** Per-marketplace availability, reported honestly. */
  availability: { key: string; label: string; reachable: boolean; tier: ScanTier }[];
  /** True only if at least one live external marketplace answered. */
  liveExternal: boolean;
}

/**
 * Global search. Tier 1 (Russia) is the default and always includes the
 * platform's own catalogue. Tier 2 (global) is opt-in per the seller's request
 * — cross-border offers are kept out of the home-market verdict unless asked.
 */
export async function searchGlobally(
  query: ExternalSearchQuery,
  tier: ScanTier = 1,
): Promise<GlobalSearchReport> {
  const availability = await getMarketplaceAvailability();
  const warnings: string[] = [];

  // Platform results are always authoritative and always VERIFIED.
  const platformRows = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    take: 40,
    include: { sellerProfile: { select: { displayName: true } }, images: { take: 1 } },
  });
  const q = query.text.toLowerCase();
  const platformHits: GlobalSearchHit[] = platformRows
    .filter((p) => p.title.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))
    .map((p) => ({
      source: "platform" as const,
      title: p.title,
      url: `/product/${p.id}`,
      priceKopecks: p.priceKopecks,
      oldPriceKopecks: p.oldPriceKopecks ?? undefined,
      rating: p.rating,
      reviewsCount: p.reviewsCount,
      sellerName: p.sellerProfile?.displayName ?? undefined,
      imageUrl: p.images[0]?.url,
      confidence: "VERIFIED" as const,
    }));

  // External results — each marketplace answers independently, scoped to tier.
  const external: ExternalSearchResult[] = await searchMarketplaceTier(query, tier);
  const liveExternal = external.some((r) => r.status === "OK" && r.confidence === "VERIFIED");

  const externalHits: GlobalSearchHit[] = [];
  for (const result of external) {
    if (result.status !== "OK") {
      if (result.status === "UNREACHABLE" || result.status === "BLOCKED") {
        warnings.push(
          `${result.marketplace}: недоступно (${result.warning}). Интеграция размечена PENDING_EXTERNAL_ACCESS.`,
        );
      } else if (result.status !== "EMPTY") {
        warnings.push(`${result.marketplace}: ${result.warning}`);
      }
      continue;
    }
    for (const offer of result.offers) {
      externalHits.push({
        source: "external",
        marketplace: offer.marketplace,
        externalId: offer.externalId,
        title: offer.title,
        url: offer.url,
        priceKopecks: offer.priceKopecks,
        oldPriceKopecks: offer.oldPriceKopecks,
        rating: offer.rating,
        reviewsCount: offer.reviewsCount,
        sellerName: offer.sellerName,
        brand: offer.brand,
        imageUrl: offer.imageUrl,
        confidence: result.confidence,
      });
    }
    if (result.confidence === "NOT_PROVEN" && result.warning) {
      warnings.push(`${result.marketplace}: ${result.warning}`);
    }
  }

  // Pro-platform ranking (product requirement): the platform's own catalogue
  // is always presented first and, all else equal, wins the comparison. Only a
  // genuinely cheaper external offer can outrank a platform offer — and even
  // then the buyer sees the platform alternative alongside it.
  const all = [...platformHits, ...externalHits].sort((a, b) => {
    if (a.source !== b.source) return a.source === "platform" ? -1 : 1;
    return a.priceKopecks - b.priceKopecks;
  });

  const cheapestPlatform = platformHits.length
    ? Math.min(...platformHits.map((h) => h.priceKopecks))
    : null;
  const cheapestExternal = externalHits.length
    ? Math.min(...externalHits.map((h) => h.priceKopecks))
    : null;
  const platformAdvantage =
    cheapestPlatform !== null && cheapestExternal !== null
      ? {
          cheapestPlatform,
          cheapestExternal,
          /** True only when the platform is genuinely the cheapest option. */
          platformIsCheapest: cheapestPlatform <= cheapestExternal,
          savingKopecks: Math.max(0, cheapestExternal - cheapestPlatform),
        }
      : null;

  return {
    query: query.text,
    tier,
    tierLabel: tierLabel(tier),
    hits: all.slice(0, query.limit ?? 20),
    bySource: { platform: platformHits.length, external: externalHits.length },
    platformAdvantage,
    warnings,
    availability,
    liveExternal,
  };
}

export interface ExternalCompetitorScan {
  productId: string;
  ownTitle: string;
  ownPriceKopecks: number;
  ownRating: number;
  tier: ScanTier;
  marketplaces: {
    key: string;
    label: string;
    status: ExternalSearchResult["status"];
    confidence: "VERIFIED" | "NOT_PROVEN";
    offers: ExternalOffer[];
    warning?: string;
  }[];
  /** Live external offers only — used for the price-position verdict. */
  verifiedOffers: ExternalOffer[];
  cheaperCount: number;
  minExternalPrice: number | null;
  verdict: string;
  liveExternal: boolean;
}

/**
 * Scans external marketplaces for offers matching a product and records them
 * as competitor listings. The seller keeps their own price; Svetlana only
 * reports the market position and never changes anything without approval.
 */
export async function scanExternalCompetitors(
  productId: string,
  options?: { marketplaces?: string[]; limit?: number; tier?: ScanTier },
): Promise<ExternalCompetitorScan> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { sellerProfile: true },
  });
  if (!product) throw new Error("товар не найден");

  const tier = options?.tier ?? 1;
  const results = await searchMarketplaceTier(
    { text: product.title, limit: options?.limit ?? 10 },
    tier,
  );

  const marketplaces = results.map((r) => ({
    key: r.marketplace,
    label: r.marketplace,
    status: r.status,
    confidence: r.confidence,
    offers: r.offers,
    warning: r.warning,
  }));

  const verifiedOffers = results
    .filter((r) => r.status === "OK" && r.confidence === "VERIFIED")
    .flatMap((r) => r.offers)
    .sort((a, b) => a.priceKopecks - b.priceKopecks);

  // Persist every parsed offer as a competitor listing so the seller sees a
  // price history over time (spec §54 price intelligence).
  if (verifiedOffers.length > 0) {
    await prisma.competitorListing.createMany({
      data: verifiedOffers.map((o) => ({
        productId,
        sellerName: o.sellerName ?? o.marketplace,
        sellerUrl: o.url,
        priceKopecks: o.priceKopecks,
        currency: o.currency,
        rating: o.rating ?? null,
        reviewsCount: o.reviewsCount ?? null,
        notes: `${o.marketplace}${o.brand ? ` · ${o.brand}` : ""}`,
      })),
    });
  }

  const cheaper = verifiedOffers.filter((o) => o.priceKopecks < product.priceKopecks);
  const minPrice = verifiedOffers.length ? verifiedOffers[0].priceKopecks : null;
  const liveExternal = verifiedOffers.length > 0;

  let verdict: string;
  if (!liveExternal) {
    verdict =
      tier === 2
        ? "Глобальные площадки сейчас недоступны (нет сетевого доступа или бот-защита). Статус интеграции — PENDING_EXTERNAL_ACCESS. Конкурентный анализ выполнен только по данным платформы."
        : "Российские маркетплейсы сейчас недоступны (нет сетевого доступа или бот-защита). Статус интеграции — PENDING_EXTERNAL_ACCESS. Конкурентный анализ выполнен только по данным платформы.";
  } else if (minPrice === null) {
    verdict = "Внешних предложений по этому товару не найдено.";
  } else if (product.priceKopecks > minPrice) {
    verdict = `Ваша цена ${fromKopecks(product.priceKopecks)} ₽ выше минимального внешнего предложения ${fromKopecks(minPrice)} ₽ на ${fromKopecks(product.priceKopecks - minPrice)} ₽. Дешевле вас ${cheaper.length} предложений.`;
  } else {
    const margin = minPrice - product.priceKopecks;
    verdict = `Ваша цена ${fromKopecks(product.priceKopecks)} ₽ — ниже минимального внешнего предложения ${fromKopecks(minPrice)} ₽ на ${fromKopecks(margin)} ₽. У вас ценовое преимущество.`;
  }

  return {
    productId,
    ownTitle: product.title,
    ownPriceKopecks: product.priceKopecks,
    ownRating: product.rating,
    tier,
    marketplaces,
    verifiedOffers,
    cheaperCount: cheaper.length,
    minExternalPrice: minPrice,
    verdict,
    liveExternal,
  };
}
