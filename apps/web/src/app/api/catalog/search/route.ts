import { apiRoute } from "@/lib/api-helpers";
import { searchProducts, type SearchFilters } from "@/lib/domains/catalog";
import { recordEvent } from "@/lib/domains/events";
import { newTraceId } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const toNum = (v: string | null): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const filters: SearchFilters = {
    query: url.searchParams.get("q") ?? undefined,
    categorySlug: url.searchParams.get("category") ?? undefined,
    maxPrice: toNum(url.searchParams.get("maxPrice")),
    minPrice: toNum(url.searchParams.get("minPrice")),
    minRating: toNum(url.searchParams.get("minRating")),
    availabilityOnly: url.searchParams.get("availability") === "1",
    sort: (url.searchParams.get("sort") as SearchFilters["sort"]) ?? "relevance",
    limit: toNum(url.searchParams.get("limit")),
    offset: toNum(url.searchParams.get("offset")),
  };
  const { results, total, mode } = await searchProducts(filters, newTraceId("api-search"));
  await recordEvent({
    type: "SEARCH",
    payload: { query: filters.query, mode, count: results.length },
    anonymous: true,
  });
  return Response.json({
    total,
    mode,
    items: results.map((r) => ({
      id: r.product.id,
      title: r.product.title,
      slug: r.product.seoSlug,
      priceKopecks: r.product.priceKopecks,
      oldPriceKopecks: r.product.oldPriceKopecks,
      rating: r.product.rating,
      reviewsCount: r.product.reviewsCount,
      seller: { id: r.product.sellerProfile.id, name: r.product.sellerProfile.displayName },
      availability: r.product.inventory?.availability ?? "UNKNOWN",
      imageUrl: null,
      signals: r.signals,
    })),
  });
});
