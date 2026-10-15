/**
 * Перенос товаров с Яндекс Маркета напрямую, по ключу API продавца.
 *
 * Продавец создаёт в кабинете Маркета токен (Api-Key) с доступом к просмотру
 * каталога и вставляет его на странице переноса. Ключ НЕ сохраняется: он живёт
 * только в браузере продавца, приходит к нам с каждым запросом по https и
 * сразу уходит на сервер Маркета. В журнал, в ответы и в ошибки не попадает.
 *
 * Сервер обращается только к api.partner.market.yandex.ru (адрес зашит), так
 * что ключом нельзя заставить нас сходить куда-то ещё.
 *
 * Отсюда берём: артикул (offerId), название, описание, цену и цену до скидки,
 * фото, бренд, штрихкод и остатки.
 *
 * Остатки берём осторожно, чтобы не продать то, чего нет:
 * - только магазины, которые возят со своего склада (FBS, DBS, Экспресс).
 *   Товар на складе Маркета (FBY) продавец отправить нашему покупателю не может;
 * - по складу берём «доступно к заказу», а если его нет, «годный» остаток;
 * - если склад или магазин в ответе не один, берём наибольшее число по одному
 *   складу, а не сумму: при группах складов Маркет повторяет один остаток.
 * Если остатки получить не удалось, количество остаётся пустым, и продавец
 * указывает наличие сам. Подтверждение наличия у нас всё равно за продавцом.
 */
import type { ImportItem } from "../catalog-import-parse";

export const MARKET_API = "https://api.partner.market.yandex.ru";
const PAGE_LIMIT = 100;
const TIMEOUT_MS = 15_000;

export class MarketError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Ключ: печатные символы без пробелов, разумной длины. */
export function validApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return /^[\x21-\x7e]{10,300}$/.test(key) ? key : null;
}

export interface MarketBusiness {
  id: number;
  name: string;
}

interface Deps {
  fetchImpl?: typeof fetch;
}

async function call(path: string, apiKey: string, init: { method: "GET" | "POST"; body?: unknown }, deps: Deps): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${MARKET_API}${path}`, {
      method: init.method,
      headers: { "Api-Key": apiKey, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new MarketError("Маркет не ответил. Попробуйте через минуту.", 502);
  }
  if (res.status === 401 || res.status === 403) {
    throw new MarketError("Маркет не принял ключ. Проверьте, что ключ скопирован целиком и у него есть доступ к просмотру каталога товаров.", 400);
  }
  if (res.status === 420 || res.status === 429) {
    throw new MarketError("Маркет просит подождать: слишком много запросов. Попробуйте через минуту.", 429);
  }
  if (!res.ok) throw new MarketError(`Маркет ответил ошибкой ${res.status}. Попробуйте позже.`, 502);
  return res.json().catch(() => {
    throw new MarketError("Маркет прислал непонятный ответ.", 502);
  });
}

/** Кабинеты (бизнесы) продавца: у одного ключа их может быть несколько. */
export async function listBusinesses(apiKey: string, deps: Deps = {}): Promise<MarketBusiness[]> {
  const data = (await call("/v2/campaigns?page=1&pageSize=50", apiKey, { method: "GET" }, deps)) as {
    campaigns?: { business?: { id?: unknown; name?: unknown } }[];
  };
  const seen = new Map<number, string>();
  for (const c of data.campaigns ?? []) {
    const id = Number(c.business?.id);
    if (Number.isSafeInteger(id) && id > 0 && !seen.has(id)) seen.set(id, typeof c.business?.name === "string" ? c.business.name.slice(0, 200) : `Кабинет ${id}`);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

interface MarketOffer {
  offerId?: unknown;
  name?: unknown;
  description?: unknown;
  pictures?: unknown;
  vendor?: unknown;
  barcodes?: unknown;
  basicPrice?: { value?: unknown; currencyId?: unknown; discountBase?: unknown } | null;
  archived?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Один товар Маркета в строку переноса. Цены только в рублях. */
export function mapOffer(offer: MarketOffer): { item: ImportItem } | { problem: string } | { skip: true } {
  if (offer.archived === true) return { skip: true };
  const title = text(offer.name, 300);
  const article = text(offer.offerId, 100);
  if (!title) return { problem: `товар ${article || "без артикула"}: нет названия` };
  const price = Number(offer.basicPrice?.value);
  const currency = offer.basicPrice?.currencyId;
  if (!Number.isFinite(price) || price <= 0) return { problem: `«${title.slice(0, 40)}»: на Маркете не указана цена` };
  if (currency !== undefined && currency !== "RUR" && currency !== "RUB") return { problem: `«${title.slice(0, 40)}»: цена не в рублях` };
  const base = Number(offer.basicPrice?.discountBase);
  const pictures = Array.isArray(offer.pictures) ? offer.pictures.filter((u): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u) && u.length <= 1000) : [];
  const barcodes = Array.isArray(offer.barcodes) ? offer.barcodes.filter((b): b is string => typeof b === "string" && b.trim() !== "") : [];
  return {
    item: {
      article,
      title,
      description: text(offer.description, 4000),
      priceRub: Math.round(price * 100) / 100,
      oldPriceRub: Number.isFinite(base) && base > price ? Math.round(base * 100) / 100 : undefined,
      images: pictures.slice(0, 10),
      brand: text(offer.vendor, 100) || undefined,
      barcode: barcodes[0]?.trim().slice(0, 50),
    },
  };
}

export interface OfferPage {
  items: ImportItem[];
  problems: string[];
  nextPageToken: string | null;
}

/** Одна страница каталога (до 100 товаров). */
export async function fetchOfferPage(apiKey: string, businessId: number, pageToken: string | null, deps: Deps = {}): Promise<OfferPage> {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (pageToken) query.set("page_token", pageToken);
  const data = (await call(`/v2/businesses/${businessId}/offer-mappings?${query}`, apiKey, { method: "POST", body: {} }, deps)) as {
    result?: { paging?: { nextPageToken?: unknown }; offerMappings?: { offer?: MarketOffer }[] };
  };
  const items: ImportItem[] = [];
  const problems: string[] = [];
  for (const m of data.result?.offerMappings ?? []) {
    if (!m.offer) continue;
    const mapped = mapOffer(m.offer);
    if ("item" in mapped) items.push(mapped.item);
    else if ("problem" in mapped) problems.push(mapped.problem);
  }
  const next = data.result?.paging?.nextPageToken;
  return { items, problems, nextPageToken: typeof next === "string" && next ? next : null };
}

/** Магазины, которые отгружают со склада продавца. */
const OWN_WAREHOUSE_PLACEMENTS = new Set(["FBS", "DBS", "EXPRESS"]);
const MAX_CAMPAIGNS = 10;

/** Магазины (кампании) кабинета, где остатки лежат у самого продавца. */
export async function ownWarehouseCampaigns(apiKey: string, businessId: number, deps: Deps = {}): Promise<number[]> {
  const data = (await call("/v2/campaigns?page=1&pageSize=50", apiKey, { method: "GET" }, deps)) as {
    campaigns?: { id?: unknown; placementType?: unknown; business?: { id?: unknown } }[];
  };
  const ids: number[] = [];
  for (const c of data.campaigns ?? []) {
    const id = Number(c.id);
    if (Number(c.business?.id) !== businessId || !Number.isSafeInteger(id) || id <= 0) continue;
    if (typeof c.placementType !== "string" || !OWN_WAREHOUSE_PLACEMENTS.has(c.placementType)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_CAMPAIGNS);
}

interface StockResponse {
  result?: { warehouses?: { offers?: { offerId?: unknown; stocks?: { type?: unknown; count?: unknown }[] }[] }[] };
}

function countOf(stocks: { type?: unknown; count?: unknown }[] | undefined, type: string): number | undefined {
  const row = (stocks ?? []).find((s) => s.type === type);
  const n = Number(row?.count);
  return row && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Ответы Маркета по магазинам в «артикул → остаток». Чистая функция. */
export function combineStocks(responses: StockResponse[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of responses) {
    for (const w of r.result?.warehouses ?? []) {
      for (const o of w.offers ?? []) {
        const id = typeof o.offerId === "string" ? o.offerId.trim() : "";
        if (!id) continue;
        const n = countOf(o.stocks, "AVAILABLE") ?? countOf(o.stocks, "FIT");
        if (n === undefined) continue;
        out.set(id, Math.max(out.get(id) ?? 0, n));
      }
    }
  }
  return out;
}

/**
 * Остатки для страницы товаров. null, если Маркет их не отдал: тогда
 * количество не трогаем. Ошибка отдельного магазина не ломает перенос.
 */
export async function fetchStocks(apiKey: string, businessId: number, offerIds: string[], deps: Deps = {}): Promise<Map<string, number> | null> {
  const ids = [...new Set(offerIds.map((id) => id.trim()).filter(Boolean))].slice(0, 500);
  if (ids.length === 0) return null;
  const campaigns = await ownWarehouseCampaigns(apiKey, businessId, deps);
  const responses: StockResponse[] = [];
  for (const campaignId of campaigns) {
    try {
      responses.push((await call(`/v2/campaigns/${campaignId}/offers/stocks`, apiKey, { method: "POST", body: { offerIds: ids } }, deps)) as StockResponse);
    } catch {
      // Магазин без доступа к остаткам или временная ошибка: пропускаем.
    }
  }
  return responses.length > 0 ? combineStocks(responses) : null;
}

/** Проставляет остатки в строки переноса. Неизвестный остаток не трогаем. */
export function withStocks(items: ImportItem[], stocks: Map<string, number> | null): ImportItem[] {
  if (!stocks) return items;
  return items.map((it) => (stocks.has(it.article) ? { ...it, quantity: stocks.get(it.article) } : it));
}
