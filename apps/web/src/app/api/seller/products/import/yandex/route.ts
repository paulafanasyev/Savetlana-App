import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { fetchOfferPage, listBusinesses, MarketError, validApiKey } from "@/lib/domains/yandex-market";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Перенос с Маркета по ключу. Без businessId: список кабинетов продавца.
 * С businessId: одна страница товаров. Ключ нигде не сохраняется.
 */
export const POST = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  const decision = await consumeRateLimit(`yandex-import:${sellerId}`, 300, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ apiKey?: unknown; businessId?: unknown; pageToken?: unknown }>(request);
  const apiKey = validApiKey(body.apiKey);
  if (!apiKey) return Response.json({ error: "Вставьте ключ API из кабинета Маркета.", code: "bad_key" }, { status: 400 });
  try {
    const businessId = Number(body.businessId);
    if (!Number.isSafeInteger(businessId) || businessId <= 0) {
      return Response.json({ businesses: await listBusinesses(apiKey) });
    }
    const pageToken = typeof body.pageToken === "string" && /^[\w.~=+/-]{1,500}$/.test(body.pageToken) ? body.pageToken : null;
    return Response.json(await fetchOfferPage(apiKey, businessId, pageToken));
  } catch (e) {
    if (e instanceof MarketError) return Response.json({ error: e.message, code: "market_error" }, { status: e.status });
    throw e;
  }
});
