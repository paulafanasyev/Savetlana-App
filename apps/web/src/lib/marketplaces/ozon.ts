/**
 * Ozon public catalog adapter.
 *
 * Reads the public storefront feed Ozon's own web client uses
 * (`/api/composer-api.bv2/page/v2?url=/search/?text=…`). No seller API tokens,
 * no access to other sellers' private cabinets — public catalog listings only.
 *
 * Response shape: `widgetStates` is an array of JSON-encoded widget strings.
 * Product tiles live inside grid/list widgets; widget names change over time,
 * so the parser looks for ANY widget containing tile-shaped items rather than
 * a single hard-coded key. Prices in `price.currentPrice` are RUBLES (float)
 * and are converted to kopecks here.
 */
import type {
  ExternalOffer,
  ExternalSearchQuery,
  ExternalSearchResult,
  MarketplaceAdapter,
} from "./types";
import { BROWSER_HEADERS, checkPricePlausibility, clampLimit, nowMs } from "./normalize";

const PAGE_URL = "https://www.ozon.ru/api/composer-api.bv2/page/v2";

interface OzonPageResponse {
  widgetStates?: unknown[];
}

interface OzonItem {
  action?: { link?: string };
  title?: string;
  price?: { currentPrice?: number; originalPrice?: number };
  rating?: number;
  feedbacksCount?: number;
  brand?: string;
  sellerName?: string;
  image?: { link?: string };
  availability?: { isAvailable?: boolean; text?: string };
  delivery?: { text?: string };
}

export class OzonAdapter implements MarketplaceAdapter {
  readonly key = "ozon";
  readonly label = "Ozon";
  readonly region = "RU" as const;
  readonly currency = "RUB";
  readonly sandbox = false;

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(
        `${PAGE_URL}?url=${encodeURIComponent("/search/?text=тест")}`,
        { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return false;
      const body = (await res.json()) as OzonPageResponse;
      return Array.isArray(body.widgetStates);
    } catch {
      return false;
    }
  }

  async search(query: ExternalSearchQuery): Promise<ExternalSearchResult> {
    const startedAt = nowMs();
    const limit = clampLimit(query.limit);
    const url = `${PAGE_URL}?url=${encodeURIComponent(`/search/?text=${query.text}&page=1`)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return notOk("UNREACHABLE", startedAt, "сеть до Ozon недоступна");
    }

    if (res.status === 403 || res.status === 401) {
      return notOk("BLOCKED", startedAt, "Ozon отклонил запрос (бот-защита)");
    }
    if (!res.ok) {
      return notOk("UNREACHABLE", startedAt, `HTTP ${res.status}`);
    }

    let body: OzonPageResponse;
    try {
      body = (await res.json()) as OzonPageResponse;
    } catch {
      return notOk("PARSE_FAILED", startedAt, "ответ Ozon не разобран как JSON");
    }

    const items = extractItems(body.widgetStates);
    if (items.length === 0) return notOk("EMPTY", startedAt, "нет предложений");

    const offers: ExternalOffer[] = items
      .map((i) => toOffer(i))
      .filter((o): o is ExternalOffer => o !== null)
      .filter(
        (o) =>
          (query.minPriceKopecks === undefined || o.priceKopecks >= query.minPriceKopecks) &&
          (query.maxPriceKopecks === undefined || o.priceKopecks <= query.maxPriceKopecks),
      )
      .slice(0, limit);

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
 * Walks the opaque `widgetStates` array and collects tile items from any
 * widget that looks like a product grid. Being shape-driven (not name-driven)
 * keeps this working when Ozon renames widget types.
 */
function extractItems(widgetStates: unknown[] | undefined): OzonItem[] {
  if (!Array.isArray(widgetStates)) return [];
  const out: OzonItem[] = [];

  for (const raw of widgetStates) {
    if (typeof raw !== "string") continue;
    try {
      const widget = JSON.parse(raw) as Record<string, unknown>;
      const candidates = [widget.items, widget.searchResults, widget.products, widget.list];
      for (const c of candidates) {
        if (Array.isArray(c)) {
          for (const item of c) {
            if (looksLikeTile(item)) out.push(item as OzonItem);
          }
        }
      }
    } catch {
      // widget strings that are not JSON are simply skipped
    }
  }
  return out;
}

function looksLikeTile(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.title === "string" &&
    typeof i.price === "object" &&
    i.price !== null &&
    typeof (i.price as Record<string, unknown>).currentPrice === "number"
  );
}

function toOffer(item: OzonItem): ExternalOffer | null {
  const link = item.action?.link;
  const price = item.price?.currentPrice;
  if (!item.title || typeof price !== "number" || price <= 0) return null;

  const url = link
    ? link.startsWith("http")
      ? link
      : `https://www.ozon.ru${link}`
    : `https://www.ozon.ru/search/?text=${encodeURIComponent(item.title)}`;

  const original = item.price?.originalPrice;
  return {
    marketplace: "ozon",
    externalId: link ? link.replace(/[/?].*$/, "") : item.title,
    title: item.title,
    url,
    priceKopecks: Math.round(price * 100),
    oldPriceKopecks:
      typeof original === "number" && original > price ? Math.round(original * 100) : undefined,
    currency: "RUB",
    rating: typeof item.rating === "number" ? item.rating : undefined,
    reviewsCount: typeof item.feedbacksCount === "number" ? item.feedbacksCount : undefined,
    brand: item.brand,
    sellerName: item.sellerName,
    inStock: item.availability?.isAvailable !== false,
    deliveryText: item.delivery?.text,
    imageUrl: item.image?.link,
  };
}

function notOk(status: string, startedAt: number, warning: string): ExternalSearchResult {
  return {
    marketplace: "ozon",
    offers: [],
    status: status as ExternalSearchResult["status"],
    confidence: "NOT_PROVEN",
    warning,
    latencyMs: nowMs() - startedAt,
  };
}
