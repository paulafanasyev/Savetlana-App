/**
 * Shared normalisation + price-plausibility guard for external feeds.
 *
 * External marketplaces disagree about price units (rubles vs kopecks vs
 * scaled integers). Guessing wrong produces prices that are 100x off — which
 * is exactly the kind of fabricated commerce data spec §49 forbids. So every
 * parsed batch is validated: if the median price is implausible for a real
 * product, the batch is downgraded to NOT_PROVEN with the reason recorded
 * instead of being stored as fact.
 */
import type { ExternalOffer, OfferConfidence } from "./types";

/** Anything outside this window is treated as a unit/scale mistake. */
const PLAUSIBLE_MIN_KOPECKS = 1_000; // 10 ₽
const PLAUSIBLE_MAX_KOPECKS = 50_000_000; // 500 000 ₽

export interface PlausibilityVerdict {
  confidence: OfferConfidence;
  warning?: string;
}

export function checkPricePlausibility(offers: ExternalOffer[]): PlausibilityVerdict {
  if (offers.length === 0) return { confidence: "VERIFIED" };

  const prices = offers.map((o) => o.priceKopecks).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];

  if (median < PLAUSIBLE_MIN_KOPECKS) {
    return {
      confidence: "NOT_PROVEN",
      warning: `медианная цена ${median / 100} ₽ неправдоподобно мала — вероятно, единицы измерения площадки отличаются от ожидаемых. Требуется ручная проверка перед использованием.`,
    };
  }
  if (median > PLAUSIBLE_MAX_KOPECKS) {
    return {
      confidence: "NOT_PROVEN",
      warning: `медианная цена ${median / 100} ₽ неправдоподобно велика — вероятно, единицы измерения площадки отличаются от ожидаемых. Требуется ручная проверка перед использованием.`,
    };
  }
  return { confidence: "VERIFIED" };
}

export function clampLimit(limit: number | undefined, max = 30): number {
  if (!limit || limit <= 0) return 10;
  return Math.min(limit, max);
}

export function nowMs(): number {
  return Date.now();
}

/**
 * Browser-like headers. Public catalog endpoints reject the default
 * `node-fetch`/undici user agent outright, so a realistic UA is required for
 * the adapter to work in production.
 */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

export function unreachable<T extends { status: string; latencyMs: number }>(
  startedAt: number,
  status: string,
  reason: unknown,
): T {
  // Never log the raw error body: it may carry request echoes. Keep it structural.
  const message = reason instanceof Error ? reason.message : "network failure";
  return { status, latencyMs: nowMs() - startedAt, offers: [], confidence: "NOT_PROVEN", warning: message } as unknown as T;
}
