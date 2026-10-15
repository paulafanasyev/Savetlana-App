/**
 * Обновление остатков с Яндекс Маркета у уже перенесённых товаров.
 *
 * Ключ, как и при переносе, не сохраняется: продавец вставляет его, мы
 * читаем остатки и забываем ключ. Поэтому обновление запускает продавец
 * кнопкой, само по расписанию оно не идёт.
 *
 * Правила:
 * - трогаем только остаток, цену не меняем;
 * - только товары, перенесённые из файла или с Маркета, у которых записан
 *   артикул продавца; артикул ищем среди товаров Маркета;
 * - если Маркет не вернул остаток по артикулу, остаток у нас не трогаем;
 * - сначала показываем, что изменится, и только по второму нажатию меняем.
 *   Изменения идут через массовое редактирование, с записью в журнал товара.
 */
import { prisma } from "../prisma";
import { applyBulkUpdate } from "./seller-bulk";
import { fetchStocks } from "./yandex-market";

export const SYNC_BATCH = 200;

/** Артикул продавца из характеристик, которые записал перенос. */
export function sellerArticle(attributes: string | null | undefined): string {
  if (!attributes) return "";
  try {
    const value = (JSON.parse(attributes) as Record<string, unknown>)["Артикул продавца"];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export interface SyncProduct {
  id: string;
  title: string;
  article: string;
  quantity: number;
}

export interface StockChange {
  title: string;
  from: number;
  to: number;
}

/** Что поменяется. Чистая функция. */
export function planStockSync(products: SyncProduct[], stocks: Map<string, number>) {
  const items: { id: string; stockQuantity: number }[] = [];
  const changes: StockChange[] = [];
  let notOnMarket = 0;
  let unchanged = 0;
  for (const p of products) {
    const to = stocks.get(p.article);
    if (to === undefined) {
      notOnMarket += 1;
      continue;
    }
    if (to === p.quantity) {
      unchanged += 1;
      continue;
    }
    items.push({ id: p.id, stockQuantity: to });
    changes.push({ title: p.title, from: p.quantity, to });
  }
  return { items, changes, notOnMarket, unchanged };
}

export interface SyncResult {
  stocksLoaded: boolean;
  checked: number;
  changes: StockChange[];
  updated: number;
  notOnMarket: number;
  unchanged: number;
  skipped: { title: string; reason: string }[];
  nextCursor: string | null;
}

export async function syncMarketStocks(input: {
  sellerId: string;
  actorId: string;
  verified: boolean;
  apiKey: string;
  businessId: number;
  cursor: string | null;
  dryRun: boolean;
}): Promise<SyncResult> {
  const rows = await prisma.product.findMany({
    where: { sellerId: input.sellerId, aiGeneratedFrom: "catalog-import", ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
    orderBy: { id: "asc" },
    take: SYNC_BATCH,
    select: { id: true, title: true, attributes: true, inventory: { select: { quantity: true } } },
  });
  const nextCursor = rows.length === SYNC_BATCH ? (rows[rows.length - 1]?.id ?? null) : null;
  const products: SyncProduct[] = rows
    .map((r) => ({ id: r.id, title: r.title, article: sellerArticle(r.attributes), quantity: r.inventory?.quantity ?? 0 }))
    .filter((p) => p.article);
  const empty: SyncResult = { stocksLoaded: true, checked: products.length, changes: [], updated: 0, notOnMarket: 0, unchanged: 0, skipped: [], nextCursor };
  if (products.length === 0) return empty;

  const stocks = await fetchStocks(input.apiKey, input.businessId, products.map((p) => p.article));
  if (!stocks) return { ...empty, stocksLoaded: false, nextCursor: null };

  const plan = planStockSync(products, stocks);
  const base = { ...empty, changes: plan.changes, notOnMarket: plan.notOnMarket, unchanged: plan.unchanged };
  if (input.dryRun || plan.items.length === 0) return base;

  const result = await applyBulkUpdate({ sellerId: input.sellerId, actorId: input.actorId, verified: input.verified, items: plan.items });
  return { ...base, changes: result.changes.map((c) => ({ title: c.title, from: c.stockFrom ?? 0, to: c.stockTo ?? 0 })), updated: result.updated, skipped: result.skipped };
}
