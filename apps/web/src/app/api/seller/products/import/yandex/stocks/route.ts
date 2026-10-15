import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { getSellerOnboardingGate } from "@/lib/domains/seller-onboarding";
import { MarketError, validApiKey } from "@/lib/domains/yandex-market";
import { syncMarketStocks } from "@/lib/domains/market-stock-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Остатки с Маркета для уже перенесённых товаров, пачками по 200.
 * dryRun (по умолчанию): только показать, что изменится. Ключ не сохраняется.
 */
export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const decision = await consumeRateLimit(`market-stocks:${sellerId}`, 120, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ apiKey?: unknown; businessId?: unknown; cursor?: unknown; dryRun?: unknown }>(request);
  const apiKey = validApiKey(body.apiKey);
  if (!apiKey) return Response.json({ error: "Вставьте ключ API из кабинета Маркета.", code: "bad_key" }, { status: 400 });
  const businessId = Number(body.businessId);
  if (!Number.isSafeInteger(businessId) || businessId <= 0) return Response.json({ error: "Выберите кабинет Маркета.", code: "bad_business" }, { status: 400 });
  const cursor = typeof body.cursor === "string" && /^[\w-]{1,100}$/.test(body.cursor) ? body.cursor : null;
  const gate = await getSellerOnboardingGate(sellerId);
  try {
    const result = await syncMarketStocks({ sellerId, actorId: user.id, verified: gate.active, apiKey, businessId, cursor, dryRun: body.dryRun !== false });
    return Response.json(result);
  } catch (e) {
    if (e instanceof MarketError) return Response.json({ error: e.message, code: "market_error" }, { status: e.status });
    throw e;
  }
});
