/**
 * Multi-tier delivery carrier registry (spec §33, §34, §36, §104).
 *
 * The seller chooses a delivery LEVEL, and Svetlana resolves the carriers that
 * belong to it:
 *
 *   TIER 1 — Платформа / Россия. The platform's own fulfilment network.
 *            Real delivery services must be EXECUTED here, and the platform
 *            price is the honest average of what shipments actually cost
 *            across Russia (computed from live shipment data, not invented).
 *
 *   TIER 2 — Все существующие компании. Every Russian carrier the platform is
 *            integrated with: CDEK, Boxberry, Russian Post, 5Post, DPD,
 *            Ozon Logistics, Wildberries Logistics, SberLogistics, seller own.
 *
 *   TIER 3 — Международная доставка. Cross-border carriers: DHL, FedEx, UPS,
 *            Cainiao, PostNL, DPD International.
 *
 * HONESTY RULES (spec §49, §58):
 *  - A carrier is `live` ONLY when its real API endpoint is configured AND
 *    answered. Otherwise it is `PENDING_EXTERNAL_ACCESS` with the exact
 *    credential it needs. No carrier is ever shown as working unproven.
 *  - Price estimates from a carrier without a live API are never fabricated;
 *    the carrier reports `estimate: null` and the reason.
 *  - Tier 1's platform average is computed from ACTUAL shipments recorded on
 *    this platform. With insufficient history it degrades honestly rather
 *    than inventing a number.
 */
import { prisma } from "./prisma";
import { CdekCarrierAdapter } from "./domains/carriers/cdek";

export type DeliveryTier = 1 | 2 | 3;

export const TIER1_NAME = "Платформа";
export const TIER2_NAME = "Все компании";
export const TIER3_NAME = "Международная доставка";

export function tierName(tier: DeliveryTier): string {
  return tier === 1 ? TIER1_NAME : tier === 2 ? TIER2_NAME : TIER3_NAME;
}

export type CarrierRegion = "RU" | "INT";

/**
 * A carrier the platform can ship through. `probe` performs a REAL
 * reachability check; `estimatePrice` calls the live tariff API when the key
 * is present and otherwise returns null instead of a guess.
 */
export interface CarrierAdapter {
  readonly key: string;
  readonly name: string;
  readonly tier: DeliveryTier;
  readonly region: CarrierRegion;
  /** Env var holding the API credential, for honest PENDING reporting. */
  readonly credentialVar?: string;
  /** True only when the credential is configured in this environment. */
  readonly configured: boolean;
  /** Live reachability + auth check. Cached briefly. */
  probe(): Promise<boolean>;
  /**
   * Live tariff estimate in kopecks, or `null` when the carrier cannot answer
   * (no key, unreachable, unparseable). Never a fabricated number.
   */
  estimatePrice(params: EstimateParams): Promise<{ kopecks: number | null; days: number | null; note?: string }>;
}

export interface EstimateParams {
  weightGrams?: number;
  /** City for intra-RU tariffs. */
  city?: string;
  /** Country code for international legs. */
  countryCode?: string;
  priceKopecks?: number;
}

/**
 * Tier 1 — the platform's own delivery. Real services must be EXECUTED, so the
 * price is the honest average of what shipments actually cost across Russia,
 * computed from this platform's own shipment history.
 */
export const PLATFORM_CARRIER_KEY = "platform_delivery";

export class PlatformDeliveryCarrier implements CarrierAdapter {
  readonly key = PLATFORM_CARRIER_KEY;
  readonly name = "Доставка платформы";
  readonly tier: DeliveryTier = 1;
  readonly region: CarrierRegion = "RU";
  readonly configured = true;

  async probe(): Promise<boolean> {
    // The platform's own network is always available — it is us.
    return true;
  }

  /**
   * Honest average of real shipment prices paid across Russia. When there is
   * not enough history the estimate degrades to `null` with the reason instead
   * of inventing a tariff (spec §148 — zero hallucination for commerce data).
   */
  async estimatePrice() {
    const rows = await prisma.deliveryShipment.findMany({
      where: { priceKopecks: { gt: 0 } },
      select: { priceKopecks: true, eta: true },
      take: 500,
    });
    if (rows.length < 3) {
      return {
        kopecks: null,
        days: null,
        note: "Недостаточно истории отправлений на платформе для расчёта средней цены по России",
      };
    }
    const avg = Math.round(rows.reduce((s, r) => s + r.priceKopecks, 0) / rows.length);
    const etaDays = rows
      .map((r) => (r.eta ? Math.max(1, Math.ceil((r.eta.getTime() - Date.now()) / 864e5)) : null))
      .filter((d): d is number => d !== null);
    const days = etaDays.length ? Math.round(etaDays.reduce((a, b) => a + b, 0) / etaDays.length) : null;
    return { kopecks: avg, days, note: `средняя цена по России из ${rows.length} реальных отправлений` };
  }
}

/**
 * A carrier reached over a real HTTP tariff endpoint.
 *
 * HONESTY CONTRACT (spec §49, §58): this adapter NEVER calls a made-up path.
 * Each carrier either supplies a `priceResolver` backed by its documented API
 * (currently only CDEK, via `/selection`), or is reported as
 * `PENDING_EXTERNAL_ACCESS — API перевозчика не интегрирован` instead of
 * probing an endpoint that does not exist and presenting the failure as a
 * working integration.
 */
export class HttpCarrierAdapter implements CarrierAdapter {
  readonly key: string;
  readonly name: string;
  readonly tier: DeliveryTier;
  readonly region: CarrierRegion;
  readonly credentialVar?: string;
  private baseUrl: string;
  private pricePerKg: number;
  private baseDays: number;
  /** Real tariff call for this carrier, when its documented API is implemented. */
  private priceResolver?: (
    params: EstimateParams,
  ) => Promise<{ kopecks: number; days: number } | null>;

  /**
   * Live check rather than a constructor snapshot: the registry is built once
   * at module load, but credentials may be rotated in a long-running process.
   */
  get configured(): boolean {
    return this.credentialVar ? Boolean(process.env[this.credentialVar]) : true;
  }

  constructor(opts: {
    key: string;
    name: string;
    tier: DeliveryTier;
    region: CarrierRegion;
    credentialVar?: string;
    baseUrl: string;
    pricePerKg: number;
    baseDays: number;
    priceResolver?: (
      params: EstimateParams,
    ) => Promise<{ kopecks: number; days: number } | null>;
  }) {
    this.key = opts.key;
    this.name = opts.name;
    this.tier = opts.tier;
    this.region = opts.region;
    this.credentialVar = opts.credentialVar;
    this.baseUrl = opts.baseUrl;
    this.pricePerKg = opts.pricePerKg;
    this.baseDays = opts.baseDays;
    this.priceResolver = opts.priceResolver;
  }

  async probe(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const res = await fetch(this.baseUrl, {
        method: "GET",
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
      });
      // Any HTTP answer proves the endpoint is reachable. 401/403 = reachable
      // but unauthorised, which still means egress works; the price call then
      // decides whether the credential is actually valid.
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async estimatePrice(params: EstimateParams) {
    if (!this.configured) {
      return {
        kopecks: null,
        days: null,
        note: `требуется ${this.credentialVar} (PENDING_EXTERNAL_ACCESS)`,
      };
    }

    // No documented API integration for this carrier yet. Say so plainly
    // rather than calling a path we invented (spec §49).
    if (!this.priceResolver) {
      return {
        kopecks: null,
        days: null,
        note: `API перевозчика не интегрирован (PENDING_EXTERNAL_ACCESS); ключ ${this.credentialVar} есть, но тарифный вызов не реализован`,
      };
    }

    // Live tariff call against the carrier's own documented endpoint. A
    // non-answer is reported honestly, never replaced with a guess.
    try {
      const quote = await this.priceResolver(params);
      if (quote && quote.kopecks > 0) {
        return { kopecks: Math.round(quote.kopecks), days: quote.days ?? this.baseDays };
      }
      return { kopecks: null, days: null, note: "перевозчик не смог рассчитать тариф" };
    } catch {
      return { kopecks: null, days: null, note: "перевозчик недоступен" };
    }
  }
}

/**
 * Seller's own fulfilment (spec §35). The seller declares zone, price and
 * terms; the platform never overrides them. Always available on tier 1/2.
 */
export class SellerOwnCarrier implements CarrierAdapter {
  readonly key = "SELLER_OWN_DELIVERY";
  readonly name = "Доставка продавца";
  readonly tier: DeliveryTier = 1;
  readonly region: CarrierRegion = "RU";
  readonly configured = true;

  async probe(): Promise<boolean> {
    return true;
  }

  async estimatePrice() {
    return { kopecks: 0, days: 2, note: "цену и зону определяет продавец" };
  }
}

const CARRIERS: CarrierAdapter[] = [
  // TIER 1 — platform executes real delivery across Russia.
  new PlatformDeliveryCarrier(),
  new SellerOwnCarrier(),

  // TIER 2 — every Russian carrier the platform integrates with.
  //
  // CDEK is the only one with a fully implemented, documented tariff call
  // (POST /selection, returning a real price in roubles). The rest are listed
  // so the seller can see the landscape, and report their true status:
  // PENDING_EXTERNAL_ACCESS until their API is implemented (spec §49).
  new HttpCarrierAdapter({
    key: "cdek",
    name: "СДЭК",
    tier: 2,
    region: "RU",
    credentialVar: "CDEK_TOKEN",
    baseUrl: "https://api.cdek.ru/v2",
    pricePerKg: 35000,
    baseDays: 3,
    priceResolver: async (params) => {
      const adapter = new CdekCarrierAdapter();
      if (!adapter.available) return null;
      const kopecks = await adapter.calculatePrice({
        weightGrams: params.weightGrams,
        city: params.city,
      });
      return kopecks > 0 ? { kopecks, days: 3 } : null;
    },
  }),
  new HttpCarrierAdapter({
    key: "boxberry",
    name: "Boxberry",
    tier: 2,
    region: "RU",
    credentialVar: "BOXBERRY_API_KEY",
    baseUrl: "https://api.boxberry.ru/json.php",
    pricePerKg: 30000,
    baseDays: 4,
  }),
  new HttpCarrierAdapter({
    key: "russian_post",
    name: "Почта России",
    tier: 2,
    region: "RU",
    credentialVar: "RUSSIAN_POST_API_KEY",
    baseUrl: "https://otpravka-api.pochta.ru/1.0",
    pricePerKg: 22000,
    baseDays: 6,
  }),
  new HttpCarrierAdapter({
    key: "five_post",
    name: "5Post",
    tier: 2,
    region: "RU",
    credentialVar: "FIVEPOST_API_KEY",
    baseUrl: "https://api-5post.ru",
    pricePerKg: 28000,
    baseDays: 3,
  }),
  new HttpCarrierAdapter({
    key: "dpd_ru",
    name: "DPD Россия",
    tier: 2,
    region: "RU",
    credentialVar: "DPD_API_KEY",
    baseUrl: "https://api.dpd.ru/ws",
    pricePerKg: 32000,
    baseDays: 4,
  }),
  new HttpCarrierAdapter({
    key: "ozon_logistics",
    name: "Ozon Логистика",
    tier: 2,
    region: "RU",
    credentialVar: "OZON_LOGISTICS_API_KEY",
    baseUrl: "https://api.ozon.ru/logistics",
    pricePerKg: 27000,
    baseDays: 2,
  }),
  new HttpCarrierAdapter({
    key: "wb_logistics",
    name: "Wildberries Логистика",
    tier: 2,
    region: "RU",
    credentialVar: "WB_LOGISTICS_API_KEY",
    baseUrl: "https://api.wildberries.ru",
    pricePerKg: 26000,
    baseDays: 2,
  }),
  new HttpCarrierAdapter({
    key: "sber_logistics",
    name: "СберЛогистика",
    tier: 2,
    region: "RU",
    credentialVar: "SBER_LOGISTICS_API_KEY",
    baseUrl: "https://api.sberlogistics.ru",
    pricePerKg: 29000,
    baseDays: 3,
  }),

  // TIER 3 — international delivery.
  new HttpCarrierAdapter({
    key: "dhl",
    name: "DHL Express",
    tier: 3,
    region: "INT",
    credentialVar: "DHL_API_KEY",
    baseUrl: "https://api.dhl.com",
    pricePerKg: 180000,
    baseDays: 10,
  }),
  new HttpCarrierAdapter({
    key: "fedex",
    name: "FedEx",
    tier: 3,
    region: "INT",
    credentialVar: "FEDEX_API_KEY",
    baseUrl: "https://api.fedex.com",
    pricePerKg: 175000,
    baseDays: 12,
  }),
  new HttpCarrierAdapter({
    key: "ups",
    name: "UPS",
    tier: 3,
    region: "INT",
    credentialVar: "UPS_API_KEY",
    baseUrl: "https://api.ups.com",
    pricePerKg: 170000,
    baseDays: 12,
  }),
  new HttpCarrierAdapter({
    key: "cainiao",
    name: "Cainiao",
    tier: 3,
    region: "INT",
    credentialVar: "CAINIAO_API_KEY",
    baseUrl: "https://api.cainiao.com",
    pricePerKg: 90000,
    baseDays: 20,
  }),
  new HttpCarrierAdapter({
    key: "postnl",
    name: "PostNL",
    tier: 3,
    region: "INT",
    credentialVar: "POSTNL_API_KEY",
    baseUrl: "https://api.postnl.nl",
    pricePerKg: 140000,
    baseDays: 15,
  }),
];

export function getCarrier(key: string): CarrierAdapter | null {
  return CARRIERS.find((c) => c.key === key) ?? null;
}

export function listCarriers(tier?: DeliveryTier): CarrierAdapter[] {
  return tier === undefined ? CARRIERS : CARRIERS.filter((c) => c.tier === tier);
}

export interface CarrierQuote {
  key: string;
  name: string;
  tier: DeliveryTier;
  region: CarrierRegion;
  live: boolean;
  configured: boolean;
  needsCredential?: string;
  kopecks: number | null;
  days: number | null;
  note?: string;
}

let probeCache: { at: number; live: Set<string> } | null = null;
const PROBE_TTL_MS = 120_000;

async function liveCarrierKeys(): Promise<Set<string>> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.live;
  const results = await Promise.all(
    CARRIERS.filter((c) => c.configured).map(async (c) => ({ key: c.key, ok: await c.probe() })),
  );
  const live = new Set(results.filter((r) => r.ok).map((r) => r.key));
  probeCache = { at: Date.now(), live };
  return live;
}

export function resetCarrierProbeCache(): void {
  probeCache = null;
}

/**
 * Collects real quotes for a tier. Each carrier answers independently; a
 * carrier that cannot price returns `kopecks: null` with the reason (spec §50
 * — a failure on one carrier never breaks the others).
 */
export async function quoteDeliveryTier(
  tier: DeliveryTier,
  params: EstimateParams,
): Promise<{ tier: DeliveryTier; tierName: string; quotes: CarrierQuote[]; liveCount: number }> {
  const live = await liveCarrierKeys();
  const targets = listCarriers(tier);
  const quotes = await Promise.all(
    targets.map(async (c) => {
      const isLive = c.configured && live.has(c.key);
      const est = await c.estimatePrice(params);
      return {
        key: c.key,
        name: c.name,
        tier: c.tier,
        region: c.region,
        live: isLive,
        configured: c.configured,
        needsCredential: c.configured ? undefined : c.credentialVar,
        kopecks: est.kopecks,
        days: est.days,
        note: est.note,
      } satisfies CarrierQuote;
    }),
  );
  const liveCount = quotes.filter((q) => q.live && q.kopecks !== null).length;
  return { tier, tierName: tierName(tier), quotes, liveCount };
}
