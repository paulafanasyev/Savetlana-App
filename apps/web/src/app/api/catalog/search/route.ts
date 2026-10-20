import { apiRoute } from "@/lib/api-helpers";
import { searchProducts, type SearchFilters } from "@/lib/domains/catalog";
import { recordEvent } from "@/lib/domains/events";
import { ensureDemoShipCities, shipCitiesBySeller } from "@/lib/domains/seller-ship-from";
import { isDemoSeller } from "@/lib/domains/seller-trust-display";
import { resolveShipCity } from "@/lib/ship-from";
import { newTraceId } from "@/lib/ai/gateway";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const toNum = (v: string | null): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  // Демо-магазинам один раз проставляем город отгрузки; ошибка не ломает поиск.
  await ensureDemoShipCities().catch(() => {});
  // Город только из справочника: неизвестное название не фильтрует, а не обнуляет выдачу.
  const city = resolveShipCity(url.searchParams.get("city"))?.name;
  const filters: SearchFilters = {
    query: url.searchParams.get("q") ?? undefined,
    categorySlug: url.searchParams.get("category") ?? undefined,
    maxPrice: toNum(url.searchParams.get("maxPrice")),
    minPrice: toNum(url.searchParams.get("minPrice")),
    minRating: toNum(url.searchParams.get("minRating")),
    availabilityOnly: url.searchParams.get("availability") === "1",
    shipCity: city,
    sort: (url.searchParams.get("sort") as SearchFilters["sort"]) ?? "relevance",
    limit: toNum(url.searchParams.get("limit")),
    offset: toNum(url.searchParams.get("offset")),
  };
  const { results, total, mode, corrected } = await searchProducts(filters, newTraceId("api-search"));
  await recordEvent({
    type: "SEARCH",
    payload: { query: filters.query, mode, count: results.length, corrected },
    anonymous: true,
  });
  const ids = results.map((r) => r.product.id);
  const sellerIds = [...new Set(results.map((r) => r.product.sellerProfile.id))];
  const [images, shipCities, sellerSlugs] = await Promise.all([
    ids.length
      ? prisma.productImage.findMany({ where: { productId: { in: ids } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { productId: true, url: true } })
      : Promise.resolve([] as { productId: string; url: string }[]),
    shipCitiesBySeller(sellerIds).catch(() => new Map<string, string>()),
    // Демо-магазины честно помечаем и в выдаче, не только на их странице.
    sellerIds.length
      ? prisma.sellerProfile.findMany({ where: { id: { in: sellerIds } }, select: { id: true, slug: true } }).catch(() => [] as { id: string; slug: string }[])
      : Promise.resolve([] as { id: string; slug: string }[]),
  ]);
  const demoSellers = new Set(sellerSlugs.filter((s) => isDemoSeller({ slug: s.slug })).map((s) => s.id));
  const firstImage = new Map<string, string>();
  for (const image of images) if (!firstImage.has(image.productId)) firstImage.set(image.productId, image.url);
  return Response.json({
    total,
    mode,
    city: city ?? null,
    corrected,
    items: results.map((r) => ({
      id: r.product.id,
      title: r.product.title,
      slug: r.product.seoSlug,
      priceKopecks: r.product.priceKopecks,
      oldPriceKopecks: r.product.oldPriceKopecks,
      rating: r.product.rating,
      reviewsCount: r.product.reviewsCount,
      seller: { id: r.product.sellerProfile.id, name: r.product.sellerProfile.displayName, demo: demoSellers.has(r.product.sellerProfile.id) },
      shipCity: shipCities.get(r.product.sellerProfile.id) ?? null,
      availability: r.product.inventory?.availability ?? "UNKNOWN",
      imageUrl: firstImage.get(r.product.id) ?? null,
      signals: r.signals,
    })),
  });
});
