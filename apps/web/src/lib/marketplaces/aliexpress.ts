/**
 * AliExpress global adapter (TIER 2 — global, on seller request).
 *
 * Reads the public search page (`/wholesale?SearchText=…`), which embeds the
 * product list as a `window.runParams` JSON blob. No affiliate API tokens are
 * used — public catalog listings only.
 *
 * Currency: AliExpress global quotes in USD or CNY depending on locale; every
 * offer is converted to RUB through the real CBR rate (see fx.ts). If no rate
 * is available the offer is reported as NOT_PROVEN rather than converted with
 * an invented rate (spec §49).
 */
import type {
  ExternalOffer,
  ExternalSearchQuery,
  ExternalSearchResult,
  MarketplaceAdapter,
} from "./types";
import { BROWSER_HEADERS, checkPricePlausibility, clampLimit, nowMs, unreachable } from "./normalize";
import { loadRubRates, toRubKopecks } from "./fx";

const SEARCH_URL = "https://www.aliexpress.com/wholesale";

interface AeItem {
  title?: string;
  productTitle?: string;
  price?: string | number;
  salePrice?: string | number;
  productPrice?: string | number;
  minPrice?: string | number;
  productId?: string | number;
  id?: string | number;
  productDetailUrl?: string;
  url?: string;
  star?: number;
  rating?: number;
  tradeCount?: string | number;
  orders?: string | number;
  storeName?: string;
  shopName?: string;
  image?: { imgUrl?: string };
  imgUrl?: string;
}

export class AliExpressAdapter implements MarketplaceAdapter {
  readonly key = "aliexpress";
  readonly label = "AliExpress";
  readonly region = "GLOBAL" as const;
  readonly currency = "USD";
  readonly sandbox = false;

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${SEARCH_URL}?SearchText=${encodeURIComponent("test")}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      // A redirect to a locale page is fine — the endpoint answered.
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
      res = await fetch(`${SEARCH_URL}?SearchText=${encodeURIComponent(query.text)}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
    } catch {
      return notOk("UNREACHABLE", startedAt, "сеть до AliExpress недоступна");
    }

    if (res.status === 403 || res.status === 401) {
      return notOk("BLOCKED", startedAt, "AliExpress отклонил запрос (бот-защита)");
    }
    if (!res.ok) {
      return notOk("UNREACHABLE", startedAt, `HTTP ${res.status}`);
    }

    const html = await res.text();
    const items = extractItems(html);
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
 * The wholesale page embeds the result set as
 * `<script>window.runParams = { ... }</script>`. Extracting that JSON blob is
 * more stable than scraping HTML tiles, but the blob shape changes between
 * locales, so the walk tolerates several known key names.
 */
function extractItems(html: string): AeItem[] {
  const blob = extractRunParams(html);
  if (!blob) return [];
  const out: AeItem[] = [];
  walk(blob, (node) => {
    if (!looksLikeItem(node)) return;
    out.push(node as AeItem);
  });
  return out;
}

function extractRunParams(html: string): unknown | null {
  const marker = "window.runParams";
  let idx = html.indexOf(marker);
  while (idx !== -1) {
    const eq = html.indexOf("=", idx);
    if (eq === -1) return null;
    let i = eq + 1;
    while (i < html.length && (html[i] === " " || html[i] === "\n" || html[i] === "\t")) i++;
    if (html[i] !== "{") {
      idx = html.indexOf(marker, idx + 1);
      continue;
    }
    const end = matchingBrace(html, i);
    if (end === -1) return null;
    try {
      return JSON.parse(html.slice(i, end + 1));
    } catch {
      idx = html.indexOf(marker, idx + 1);
    }
  }
  return null;
}

/** Balanced-brace scan so a JSON blob containing nested objects/strings with
 * braces inside strings is cut at the true closing brace. */
function matchingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit);
    return;
  }
  visit(node as Record<string, unknown>);
  for (const v of Object.values(node as Record<string, unknown>)) walk(v, visit);
}

function looksLikeItem(node: Record<string, unknown>): boolean {
  const n = node as AeItem;
  const title = n.title ?? n.productTitle;
  const price = n.price ?? n.salePrice ?? n.productPrice ?? n.minPrice;
  return typeof title === "string" && price !== undefined && price !== null;
}

function parsePrice(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw;
  // AliExpress prices can be strings like "US $12.99" or "12.99"
  const m = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  return Number(m[1].replace(",", "."));
}

function toOffer(item: AeItem, rates: Map<string, number>): ExternalOffer | null {
  const title = item.title ?? item.productTitle;
  const rawPrice = item.price ?? item.salePrice ?? item.productPrice ?? item.minPrice;
  if (!title) return null;
  const price = parsePrice(rawPrice);
  if (price === null || price <= 0) return null;

  // Convert to RUB via the real CBR rate; refuse to guess when no rate exists.
  const rub = toRubKopecks(price, "USD", rates);
  if (rub === null) return null;

  const productId = item.productId ?? item.id;
  const link = item.productDetailUrl ?? item.url;
  const url = link
    ? link.startsWith("http")
      ? link
      : `https://www.aliexpress.com${link}`
    : `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(title)}`;

  const orders = item.tradeCount ?? item.orders;

  return {
    marketplace: "aliexpress",
    externalId: productId !== undefined ? String(productId) : title,
    title,
    url,
    priceKopecks: rub,
    currency: "RUB",
    rating: typeof item.star === "number" ? item.star : typeof item.rating === "number" ? item.rating : undefined,
    reviewsCount: typeof orders === "number" ? orders : undefined,
    sellerName: item.storeName ?? item.shopName,
    inStock: true,
    deliveryText: "Доставка из-за рубежа (30–60 дней)",
    imageUrl: item.image?.imgUrl ?? item.imgUrl,
  };
}

function notOk(status: string, startedAt: number, warning: string): ExternalSearchResult {
  return unreachable(startedAt, status, warning);
}
