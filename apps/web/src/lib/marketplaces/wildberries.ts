/**
 * Wildberries public catalog adapter.
 *
 * Reads the same public search feed Wildberries' own storefront uses
 * (`search.wb.ru/exactmatch/ru/common/v4/search`). No supplier tokens and no
 * access to other sellers' private cabinets — only public catalog listings.
 *
 * Price units: the feed returns `priceU`/`salePriceU` as INTEGER kopecks
 * (rubles × 100). Because a wrong guess yields prices 100× off, the parsed
 * batch is validated by checkPricePlausibility before it is ever stored.
 */
import type {
  ExternalOffer,
  ExternalSearchQuery,
  ExternalSearchResult,
  MarketplaceAdapter,
} from "./types";
import { BROWSER_HEADERS, checkPricePlausibility, clampLimit, nowMs } from "./normalize";

const SEARCH_URL = "https://search.wb.ru/exactmatch/ru/common/v4/search";

interface WbProduct {
  id?: number;
  name?: string;
  brand?: string;
  supplierName?: string;
  priceU?: number;
  salePriceU?: number;
  rating?: number;
  feedbacks?: number;
  volume?: number;
  pics?: number;
}

interface WbSearchResponse {
  products?: WbProduct[];
}

export class WildberriesAdapter implements MarketplaceAdapter {
  readonly key = "wildberries";
  readonly label = "Wildberries";
  readonly region = "RU" as const;
  readonly currency = "RUB";
  readonly sandbox = false;

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(
        `${SEARCH_URL}?query=тест&dest=-1257786&page=1`,
        { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return false;
      const body = (await res.json()) as WbSearchResponse;
      return Array.isArray(body.products);
    } catch {
      return false;
    }
  }

  async search(query: ExternalSearchQuery): Promise<ExternalSearchResult> {
    const startedAt = nowMs();
    const limit = clampLimit(query.limit);
    const url =
      `${SEARCH_URL}?query=${encodeURIComponent(query.text)}` +
      `&dest=-1257786&page=1&pagesize=${limit}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return notOk("UNREACHABLE", startedAt, "сеть до Wildberries недоступна");
    }

    if (res.status === 403 || res.status === 401) {
      return notOk("BLOCKED", startedAt, "Wildberries отклонил запрос (бот-защита)");
    }
    if (!res.ok) {
      return notOk("UNREACHABLE", startedAt, `HTTP ${res.status}`);
    }

    let body: WbSearchResponse;
    try {
      body = (await res.json()) as WbSearchResponse;
    } catch {
      return notOk("PARSE_FAILED", startedAt, "ответ Wildberries не разобран как JSON");
    }

    const products = Array.isArray(body.products) ? body.products : [];
    if (products.length === 0) return notOk("EMPTY", startedAt, "нет предложений");

    const offers: ExternalOffer[] = products
      .map((p) => toOffer(p))
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

function toOffer(p: WbProduct): ExternalOffer | null {
  if (!p.id || !p.name) return null;
  const sale = typeof p.salePriceU === "number" ? p.salePriceU : undefined;
  const base = typeof p.priceU === "number" ? p.priceU : sale;
  if (base === undefined || base <= 0) return null;

  return {
    marketplace: "wildberries",
    externalId: String(p.id),
    title: p.name,
    url: `https://www.wildberries.ru/catalog/${p.id}/detail.aspx`,
    priceKopecks: Math.round(sale ?? base),
    oldPriceKopecks: sale !== undefined && base > sale ? Math.round(base) : undefined,
    currency: "RUB",
    rating: typeof p.rating === "number" ? p.rating : undefined,
    reviewsCount: typeof p.feedbacks === "number" ? p.feedbacks : undefined,
    brand: p.brand,
    sellerName: p.supplierName,
    inStock: true,
    imageUrl: p.pics ? `https://basket-01.wbbasket.ru/vol0/pics/${p.id}/1.webp` : undefined,
  };
}

function notOk(status: string, startedAt: number, warning: string): ExternalSearchResult {
  return {
    marketplace: "wildberries",
    offers: [],
    status: status as ExternalSearchResult["status"],
    confidence: "NOT_PROVEN",
    warning,
    latencyMs: nowMs() - startedAt,
  };
}
