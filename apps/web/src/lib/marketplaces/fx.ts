/**
 * Honest FX conversion via the Central Bank of Russia daily rates feed
 * (https://www.cbr-xml-daily.ru/daily_json.js — free, no key, official rates).
 *
 * WHY THIS MATTERS (spec §49 — no fake data):
 * Global marketplaces quote in CNY / USD / EUR. To compare a Taobao offer with
 * an Ozon offer, Svetlana must convert currencies. Inventing an exchange rate
 * would produce a fabricated price — exactly what the spec forbids. So the rate
 * always comes from a real feed, is cached for its validity window, and when
 * the feed is unreachable the offer is downgraded to NOT_PROVEN instead of
 * being converted with a guessed rate.
 */
import { BROWSER_HEADERS, nowMs } from "./normalize";

interface CbrValute {
  Nominal: number;
  Value: number;
}
interface CbrResponse {
  Date: string;
  Valute?: Record<string, CbrValute>;
}

const FEED_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const RUB_PER_UNIT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // rates are daily; 6h is a safe refresh

let cache: { at: number; rates: Map<string, number>; date: string | null } | null = null;

/**
 * Fetches official rates and returns RUB per 1 unit of each currency
 * (already divided by Nominal — some quotes are per 10/100 units).
 */
export async function loadRubRates(): Promise<{
  rates: Map<string, number>;
  date: string | null;
}> {
  if (cache && nowMs() - cache.at < RUB_PER_UNIT_CACHE_TTL_MS) {
    return { rates: cache.rates, date: cache.date };
  }
  try {
    const res = await fetch(FEED_URL, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`CBR feed HTTP ${res.status}`);
    const body = (await res.json()) as CbrResponse;
    const rates = new Map<string, number>();
    rates.set("RUB", 1);
    for (const [code, v] of Object.entries(body.Valute ?? {})) {
      if (v.Nominal > 0) rates.set(code, v.Value / v.Nominal);
    }
    cache = { at: nowMs(), rates, date: body.Date };
    return { rates, date: body.Date };
  } catch {
    // Keep the last good rates if we have them; never fall back to a guess.
    if (cache) return { rates: cache.rates, date: cache.date };
    return { rates: new Map<string, number>(), date: null };
  }
}

export function isFxAvailable(rates: Map<string, number>, currency: string): boolean {
  return currency === "RUB" || rates.has(currency.toUpperCase());
}

/**
 * Converts an amount in `currency` to RUB kopecks. Returns null when no real
 * rate is available — callers must treat that as NOT_PROVEN, never as a price.
 */
export function toRubKopecks(
  amount: number,
  currency: string,
  rates: Map<string, number>,
): number | null {
  const code = currency.toUpperCase();
  if (code === "RUB") return Math.round(amount * 100);
  const rate = rates.get(code);
  if (rate === undefined) return null;
  return Math.round(amount * rate * 100);
}
