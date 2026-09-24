/**
 * Marketplace adapter registry + reachability probing.
 *
 * Adapters are resolved by key. Availability is determined by a REAL probe —
 * an adapter is only reported reachable when its endpoint answered with a
 * parseable payload. Where the network is blocked (this sandbox blocks egress
 * to both marketplaces), the adapter honestly reports
 * PENDING_EXTERNAL_ACCESS instead of pretending to work (spec §49, §58).
 */
import type {
  MarketplaceAdapter,
  MarketplaceRegion,
  ExternalSearchQuery,
  ExternalSearchResult,
} from "./types";
import { WildberriesAdapter } from "./wildberries";
import { OzonAdapter } from "./ozon";
import { AliExpressAdapter } from "./aliexpress";
import { TaobaoAdapter } from "./taobao";
import { AmazonAdapter } from "./amazon";
import { checkPricePlausibility, nowMs } from "./normalize";

const ADAPTERS: Record<string, MarketplaceAdapter> = {
  // TIER 1 — Russia (always scanned)
  ozon: new OzonAdapter(),
  wildberries: new WildberriesAdapter(),
  // TIER 2 — Global (scanned only on explicit seller request)
  aliexpress: new AliExpressAdapter(),
  taobao: new TaobaoAdapter(),
  amazon: new AmazonAdapter(),
};

/** Regional tiers: RU is level 1 (mandatory), GLOBAL is level 2 (on request). */
export type ScanTier = 1 | 2;

export const TIER1_LABEL = "Россия";
export const TIER2_LABEL = "Глобально";

export function tierLabel(tier: ScanTier): string {
  return tier === 1 ? TIER1_LABEL : TIER2_LABEL;
}

export function marketplaceTier(key: string): ScanTier | null {
  const a = ADAPTERS[key];
  return a ? (a.region === "RU" ? 1 : 2) : null;
}

/**
 * Fixture-backed adapter for tests. Ships recorded responses so the full
 * parse → normalise → persist → rank pipeline is verifiable offline. It is
 * `sandbox: true` so results are never confused with live marketplace data.
 */
export class FixtureMarketplaceAdapter implements MarketplaceAdapter {
  readonly key: string;
  readonly label: string;
  readonly region: MarketplaceRegion = "RU";
  readonly currency = "RUB";
  readonly sandbox = true;
  private fixtures: Record<string, ExternalSearchResult>;

  constructor(key: string, label: string, fixtures: Record<string, ExternalSearchResult>) {
    this.key = key;
    this.label = label;
    this.fixtures = fixtures;
  }

  async probe(): Promise<boolean> {
    return true;
  }

  async search(query: ExternalSearchQuery): Promise<ExternalSearchResult> {
    const startedAt = nowMs();
    const hit = this.fixtures[query.text.toLowerCase()] ?? this.fixtures["*"];
    if (!hit) {
      return {
        marketplace: this.key,
        offers: [],
        status: "EMPTY",
        confidence: "NOT_PROVEN",
        warning: "нет записанного ответа для этого запроса (fixture)",
        latencyMs: nowMs() - startedAt,
      };
    }
    const limit = query.limit ?? 10;
    const offers = hit.offers
      .filter(
        (o) =>
          (query.minPriceKopecks === undefined || o.priceKopecks >= query.minPriceKopecks) &&
          (query.maxPriceKopecks === undefined || o.priceKopecks <= query.maxPriceKopecks),
      )
      .slice(0, limit);
    const verdict = checkPricePlausibility(offers);
    return { ...hit, offers, ...verdict, latencyMs: nowMs() - startedAt };
  }
}

export function getMarketplaceAdapter(key: string): MarketplaceAdapter | null {
  return ADAPTERS[key] ?? null;
}

export function listMarketplaceAdapters(): MarketplaceAdapter[] {
  return Object.values(ADAPTERS);
}

export interface MarketplaceAvailability {
  key: string;
  label: string;
  reachable: boolean;
  tier: ScanTier;
}

/**
 * Probes every adapter once and caches the verdict for a short window — a
 * probe is a live network call and must not run per request.
 */
let cache: { at: number; rows: MarketplaceAvailability[] } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getMarketplaceAvailability(
  tier?: ScanTier,
): Promise<MarketplaceAvailability[]> {
  if (cache && nowMs() - cache.at < CACHE_TTL_MS) {
    return cache.rows.filter((r) => tier === undefined || r.tier === tier);
  }
  const rows = await Promise.all(
    listMarketplaceAdapters().map(async (a) => ({
      key: a.key,
      label: a.label,
      reachable: await a.probe(),
      tier: (a.region === "RU" ? 1 : 2) as ScanTier,
    })),
  );
  cache = { at: nowMs(), rows };
  return rows.filter((r) => tier === undefined || r.tier === tier);
}

export function resetAvailabilityCache(): void {
  cache = null;
}

/**
 * Runs a query against the given marketplaces in parallel and returns every
 * result with its own confidence. A failure on one marketplace never breaks
 * the others (spec §50).
 *
 * Tier rule: tier 1 (Russia) is always scanned. Tier 2 (global) runs only when
 * `tier: 2` is requested — cross-border offers have different delivery and
 * customs economics and must never silently enter the home-market verdict.
 */
export async function searchMarketplaces(
  query: ExternalSearchQuery,
  keys?: string[],
): Promise<ExternalSearchResult[]> {
  const targets = (keys ?? Object.keys(ADAPTERS))
    .map((k) => getMarketplaceAdapter(k))
    .filter((a): a is MarketplaceAdapter => a !== null);
  return Promise.all(targets.map((a) => a.search(query)));
}

/**
 * Scans a tier. Tier 1 = Russia (Ozon + Wildberries). Tier 2 = global
 * (AliExpress, Taobao, Amazon). Explicit, opt-in, per the seller's request.
 */
export async function searchMarketplaceTier(
  query: ExternalSearchQuery,
  tier: ScanTier,
): Promise<ExternalSearchResult[]> {
  const keys = Object.values(ADAPTERS)
    .filter((a) => (a.region === "RU" ? tier === 1 : tier === 2))
    .map((a) => a.key);
  return searchMarketplaces(query, keys);
}

/** Adapters belonging to a tier, for honest availability reporting. */
export function listMarketplaceAdaptersByTier(tier: ScanTier): MarketplaceAdapter[] {
  return Object.values(ADAPTERS).filter((a) => (a.region === "RU" ? tier === 1 : tier === 2));
}
