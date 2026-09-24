/**
 * Amazon global adapter (TIER 2 — global, on seller request).
 *
 * Reads the public search page (`/s?k=…`). The page embeds offer data in a
 * JSON-LD `<script type="application/ld+json">` block plus rendered price
 * elements; both are parsed so a layout change degrades gracefully.
 *
 * Currency: USD by default (amazon.com), converted to RUB through the real
 * CBR rate. Amazon's bot protection returns HTTP 503 on automated requests —
 * that is reported as BLOCKED, never worked around with a fake response
 * (spec §49).
 */
import type {
  ExternalOffer,
  ExternalSearchQuery,
  ExternalSearchResult,
  MarketplaceAdapter,
} from "./types";
import { BROWSER_HEADERS, checkPricePlausibility, clampLimit, nowMs, unreachable } from "./normalize";
import { loadRubRates, toRubKopecks } from "./fx";

const SEARCH_URL = "https://www.amazon.com/s";

interface JsonLdOffer {
  "@type"?: string;
  name?: string;
  url?: string;
  image?: string;
  offers?: {
    "@type"?: string;
    price?: number | string;
    priceCurrency?: string;
    availability?: string;
    seller?: { name?: string };
  };
  aggregateRating?: { ratingValue?: number; reviewCount?: number };
}

export class AmazonAdapter implements MarketplaceAdapter {
  readonly key = "amazon";
  readonly label = "Amazon";
  readonly region = "GLOBAL" as const;
  readonly currency = "USD";
  readonly sandbox = false;

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${SEARCH_URL}?k=${encodeURIComponent("test")}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8_000),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async search(query: ExternalSearchQuery): Promise<ExternalSearchResult> {
    const startedAt = nowMs();
    const limit = clampLimit(query.limit);

    let res: Response;
    try {
      res = await fetch(`${SEARCH_URL}?k=${encodeURIComponent(query.text)}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return notOk("UNREACHABLE", startedAt, "сеть до Amazon недоступна");
    }

    if (res.status === 403 || res.status === 401) {
      return notOk("BLOCKED", startedAt, "Amazon отклонил запрос (бот-защита)");
    }
    if (res.status === 503) {
      return notOk("BLOCKED", startedAt, "Amazon требует JavaScript/challenge (HTTP 503)");
    }
    if (!res.ok) {
      return notOk("UNREACHABLE", startedAt, `HTTP ${res.status}`);
    }

    const html = await res.text();
    const items = extractJsonLd(html);
    if (items.length === 0) return notOk("EMPTY", startedAt, "нет предложений на странице");

    const { rates } = await loadRubRates();

    const offers: ExternalOffer[] = items
      .map((i) => toOffer(i, rates))
      .filter((o): o is ExternalOffer => o !== null)
      .filter(
        (o) =>
          (query.minPriceKopecks === undefined || o.priceKopecks >= query.minPriceKopecks) &&
          (query.maxPriceKopecks === undefined || o.priceKopecks <= query.maxPriceKopecks),
      )
      .slice(0, limit);

    if (offers.length === 0) return notOk("EMPTY", startedAt, "предложения не прошли фильтр");

    const verdict = checkPricePlausibility(offers);
    return {
      marketplace: this.key,
      offers,
      status: "OK",
      confidence: verdict.confidence,
      warning: verdict.warning,
      latencyMs: nowMs() - startedAt,
    };
  }
}

/**
 * Extracts every `application/ld+json` block and keeps only Product nodes with
 * a concrete offer. JSON-LD is the most stable machine-readable surface Amazon
 * publishes, so it is preferred over scraping rendered HTML.
 */
function extractJsonLd(html: string): JsonLdOffer[] {
  const out: JsonLdOffer[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as JsonLdOffer | JsonLdOffer[];
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        if (node["@type"] === "Product" && node.offers) out.push(node);
      }
    } catch {
      // malformed block — skip
    }
  }
  return out;
}

function toOffer(node: JsonLdOffer, rates: Map<string, number>): ExternalOffer | null {
  const title = node.name;
  const offer = node.offers;
  if (!title || !offer) return null;

  const rawPrice = offer.price;
  if (rawPrice === undefined || rawPrice === null) return null;
  const price = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(price) || price <= 0) return null;

  const currency = (offer.priceCurrency ?? "USD").toUpperCase();
  const rub = toRubKopecks(price, currency, rates);
  if (rub === null) return null;

  const asin = node.url?.match(/\/dp\/([A-Z0-9]+)/)?.[1];
  const url = node.url
    ? node.url.startsWith("http")
      ? node.url
      : `https://www.amazon.com${node.url}`
    : `https://www.amazon.com/s?k=${encodeURIComponent(title)}`;

  return {
    marketplace: "amazon",
    externalId: asin ?? title,
    title,
    url,
    priceKopecks: rub,
    currency: "RUB",
    rating: node.aggregateRating?.ratingValue,
    reviewsCount: node.aggregateRating?.reviewCount,
    sellerName: offer.seller?.name,
    inStock: offer.availability?.toLowerCase().includes("instock") ?? undefined,
    deliveryText: "Доставка из США (20–40 дней)",
    imageUrl: node.image,
  };
}

function notOk(status: string, startedAt: number, warning: string): ExternalSearchResult {
  return unreachable(startedAt, status, warning);
}
