import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { searchGlobally } from "@/lib/domains/external-search";
import type { ScanTier } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";

/**
 * Рыночный поиск (spec §11–§13): платформа + внешние маркетплейсы.
 *
 * Только для продавца и администратора — это инструмент анализа цен конкурентов.
 * Покупателя АИКО никогда не отправляет на другие площадки: его поиск — /api/catalog/search.
 * Tier 1 (Россия) по умолчанию; tier 2 (глобально) — по запросу.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("global-search:read", 30, 60_000)) return tooManyRequests();
  const { user } = await requireUser(request);
  if (user.role !== "SELLER" && user.role !== "ADMIN") {
    throw new ApiError(403, "Сравнение с другими площадками доступно только продавцам. Ищите товары в каталоге АИКО.", "sellers_only");
  }
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
