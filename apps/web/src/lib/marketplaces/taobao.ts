/**
 * Taobao global adapter (TIER 2 — global, on seller request).
 *
 * Reads the public mobile search feed Taobao's own storefront clients use
 * (`h5api.m.taobao.com/h5/mtop.taobao.wsearch.search/1.0/`). Public catalog
 * listings only — no access to other sellers' private cabinets.
 *
 * Currency: CNY. Every offer is converted to RUB through the real CBR rate.
 * The endpoint requires an mtop signature in strict deployments; when the
 * unsigned call is rejected the adapter reports BLOCKED honestly rather than
 * fabricating offers (spec §49).
 */
import type {
  ExternalOffer,
  ExternalSearchQuery,
  ExternalSearchResult,
  MarketplaceAdapter,
} from "./types";
import { BROWSER_HEADERS, checkPricePlausibility, clampLimit, nowMs, unreachable } from "./normalize";
import { loadRubRates, toRubKopecks } from "./fx";

const API_URL = "https://h5api.m.taobao.com/h5/mtop.taobao.wsearch.search/1.0/";

interface TbItem {
  nid?: string;
  id?: string;
  title?: string[];
  rawTitle?: string;
  price?: string;
  priceText?: string;
  viewPrice?: string;
  nick?: string;
  shopName?: string;
  sellerNick?: string;
  ratePrice?: string;
  icon?: { text?: string }[];
  commentCount?: string;
  feedback?: string;
  pic?: string;
  picUrl?: string;
}

interface TbResponse {
  data?: {
    list?: TbItem[];
    items?: TbItem[];
    resultList?: { item?: TbItem[] }[];
  };
}

export class TaobaoAdapter implements MarketplaceAdapter {
  readonly key = "taobao";
  readonly label = "Taobao";
  readonly region = "GLOBAL" as const;
  readonly currency = "CNY";
  readonly sandbox = false;

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(
        `${API_URL}?q=${encodeURIComponent("测试")}`,
        { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8_000) },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async search(query: ExternalSearchQuery): Promise<ExternalSearchResult> {
    const startedAt = nowMs();
    const limit = clampLimit(query.limit);

    let res: Response;
    try {
      res = await fetch(
        `${API_URL}?q=${encodeURIComponent(query.text)}&page=1&pageSize=${limit}`,
        { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20_000) },
      );
    } catch {
      return notOk("UNREACHABLE", startedAt, "сеть до Taobao недоступна");
    }

    if (res.status === 403 || res.status === 401) {
      return notOk("BLOCKED", startedAt, "Taobao отклонил запрос (требуется mtop-подпись)");
    }
    if (!res.ok) {
      return notOk("UNREACHABLE", startedAt, `HTTP ${res.status}`);
    }

    let body: TbResponse;
    try {
      body = (await res.json()) as TbResponse;
    } catch {
      return notOk("PARSE_FAILED", startedAt, "ответ Taobao не разобран как JSON");
    }

    const items = collectItems(body);
    if (items.length === 0) return notOk("EMPTY", startedAt, "нет предложений");

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

function collectItems(body: TbResponse): TbItem[] {
  const direct = body.data?.list ?? body.data?.items ?? [];
  const nested = (body.data?.resultList ?? []).flatMap((r) => r.item ?? []);
  return [...direct, ...nested];
}

function toOffer(item: TbItem, rates: Map<string, number>): ExternalOffer | null {
  const id = item.nid ?? item.id;
  const titleParts = item.title;
  const title =
    Array.isArray(titleParts) && titleParts.length > 0
      ? titleParts.join("")
      : typeof item.rawTitle === "string"
        ? item.rawTitle
        : undefined;
  if (!id || !title) return null;

  const rawPrice = item.price ?? item.priceText ?? item.viewPrice;
  if (!rawPrice) return null;
  const price = Number(String(rawPrice).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(price) || price <= 0) return null;

  const rub = toRubKopecks(price, "CNY", rates);
  if (rub === null) return null;

  const pic = item.pic ?? item.picUrl;

  return {
    marketplace: "taobao",
    externalId: String(id),
    title,
    url: `https://item.taobao.com/item.htm?id=${id}`,
    priceKopecks: rub,
    currency: "RUB",
    sellerName: item.shopName ?? item.nick ?? item.sellerNick,
    reviewsCount: Number(item.commentCount ?? item.feedback ?? "") || undefined,
    inStock: true,
    deliveryText: "Доставка из Китая (25–45 дней)",
    imageUrl: pic
      ? pic.startsWith("//")
        ? `https:${pic}`
        : pic.startsWith("http")
          ? pic
          : `https://${pic}`
      : undefined,
  };
}

function notOk(status: string, startedAt: number, warning: string): ExternalSearchResult {
  return unreachable(startedAt, status, warning);
}
