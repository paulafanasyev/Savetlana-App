import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { searchGlobally } from "@/lib/domains/external-search";
import type { ScanTier } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";

/**
 * Global product search (spec §11–§13). Svetlana searches the platform AND
 * external marketplaces. Tier 1 (Россия) is the default; tier 2 (глобально)
 * is opt-in so cross-border offers never silently enter the home verdict.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("global-search:read", 30, 60_000)) return tooManyRequests();
  await requireUser(request);
  const url = new URL(request.url);

  const text = url.searchParams.get("q")?.trim();
  if (!text) throw new ApiError(400, "Укажите поисковый запрос (q)");

  const tierRaw = url.searchParams.get("tier");
  let tier: ScanTier = 1;
  if (tierRaw === "2") tier = 2;
  else if (tierRaw !== null && tierRaw !== "1")
    throw new ApiError(400, "Уровень поиска должен быть 1 (Россия) или 2 (глобально)");

  const limit = Number(url.searchParams.get("limit") ?? "20");
  const minPriceKopecks = url.searchParams.get("minPrice")
    ? Math.round(Number(url.searchParams.get("minPrice")) * 100)
    : undefined;
  const maxPriceKopecks = url.searchParams.get("maxPrice")
    ? Math.round(Number(url.searchParams.get("maxPrice")) * 100)
    : undefined;
  if ([limit, minPriceKopecks, maxPriceKopecks].some((n) => n !== undefined && !Number.isFinite(n)))
    throw new ApiError(400, "Некорректные числовые параметры");

  const report = await searchGlobally({ text, limit, minPriceKopecks, maxPriceKopecks }, tier);
  return Response.json(report);
});
