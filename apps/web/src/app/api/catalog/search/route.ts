import { apiRoute } from "@/lib/api-helpers";
import type { SearchFilters } from "@/lib/domains/catalog";
import { listCatalog } from "@/lib/domains/catalog-listing";
import { recordEvent } from "@/lib/domains/events";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const toNum = (v: string | null): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const listing = await listCatalog(
    {
      q: url.searchParams.get("q") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      city: url.searchParams.get("city"),
      maxPrice: toNum(url.searchParams.get("maxPrice")),
      minPrice: toNum(url.searchParams.get("minPrice")),
      minRating: toNum(url.searchParams.get("minRating")),
      availabilityOnly: url.searchParams.get("availability") === "1",
      sort: (url.searchParams.get("sort") as SearchFilters["sort"]) ?? "relevance",
      limit: toNum(url.searchParams.get("limit")),
      offset: toNum(url.searchParams.get("offset")),
    },
    "api-search",
  );
  await recordEvent({
    type: "SEARCH",
    payload: { query: listing.query, mode: listing.mode, count: listing.items.length, corrected: listing.corrected },
    anonymous: true,
  });
  return Response.json({
    total: listing.total,
    mode: listing.mode,
    city: listing.city,
    corrected: listing.corrected,
    items: listing.items,
  });
});
