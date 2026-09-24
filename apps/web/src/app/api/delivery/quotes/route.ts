import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { quoteDeliveryTier, type DeliveryTier } from "@/lib/delivery-tiers";

export const dynamic = "force-dynamic";

/**
 * Multi-tier delivery quotes (spec §33, §34, §36).
 *
 * The seller chooses the delivery LEVEL and Svetlana resolves every carrier in
 * it with a real quote:
 *   tier=1 — Платформа: реальные услуги доставки исполняются, цена = честная
 *            средняя по России по реальным отправлениям платформы.
 *   tier=2 — Все существующие компании (СДЭК, Boxberry, Почта России, 5Post,
 *            DPD, Ozon, WB, СберЛогистика).
 *   tier=3 — Международная доставка (DHL, FedEx, UPS, Cainiao, PostNL).
 *
 * Carriers without a live credential report `kopecks: null` and the exact env
 * var they need — never a fabricated price (spec §49).
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("delivery:quote", 30, 60_000)) return tooManyRequests();
  await requireUser(request);
  const url = new URL(request.url);

  const tierRaw = url.searchParams.get("tier");
  if (!tierRaw || !["1", "2", "3"].includes(tierRaw))
    throw new ApiError(400, "Укажите уровень доставки: 1 (платформа), 2 (все компании) или 3 (международная)");

  const tier = Number(tierRaw) as DeliveryTier;
  const weightGrams = url.searchParams.get("weightGrams")
    ? Number(url.searchParams.get("weightGrams"))
    : undefined;
  const city = url.searchParams.get("city") ?? undefined;
  const countryCode = url.searchParams.get("countryCode") ?? undefined;
  const priceKopecks = url.searchParams.get("declaredValue")
    ? Math.round(Number(url.searchParams.get("declaredValue")) * 100)
    : undefined;

  if ([weightGrams, priceKopecks].some((n) => n !== undefined && !Number.isFinite(n)))
    throw new ApiError(400, "Некорректные числовые параметры");

  const report = await quoteDeliveryTier(tier, { weightGrams, city, countryCode, priceKopecks });
  return Response.json(report);
});
