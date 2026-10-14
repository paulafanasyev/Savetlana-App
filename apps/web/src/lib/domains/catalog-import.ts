/**
 * Перенос магазина: создание товаров из разобранного файла (Ozon, Wildberries,
 * 1С, YML). Файл разбирается у продавца (catalog-import-parse.ts), сюда
 * приходит только список товаров, и каждая строка проверяется заново.
 *
 * Правила:
 *  - товары создаются ЧЕРНОВИКАМИ: покупатели их не видят, пока продавец не
 *    проверит и не опубликует (публикация требует верификации продавца);
 *  - наличие не считается подтверждённым: остаток из файла записывается, но
 *    гарантию наличия покупателю не обещаем, пока продавец её не подтвердит;
 *  - повторный импорт того же файла не создаёт дублей: артикул продавца
 *    превращается в стабильный код товара. У уже перенесённых товаров
 *    обновляются цена и остаток по тем же правилам, что и в массовом
 *    редактировании (честные скидки, цена опубликованного товара меняется
 *    только у проверенного продавца). Цена до скидки из файла у них не
 *    трогается: скидками управляет раздел «Акции».
 */
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { slugify, toKopecks } from "../utils";
import { computeAvailability } from "./inventory";
import { audit } from "./audit";
import { planBulk, type BulkCurrent, type BulkItem } from "./bulk-rules";
import { applyBulkUpdate } from "./seller-bulk";
import { IMPORT_MAX_ITEMS, type ImportItem } from "../catalog-import-parse";

export interface ImportUpdate {
  title: string;
  priceFromRub?: number;
  priceToRub?: number;
  stockFrom?: number;
  stockTo?: number;
}

export interface ImportOutcome {
  created: number;
  wouldCreate: number;
  updated: number;
  wouldUpdate: number;
  /** Уже перенесённые товары, у которых в файле ничего не поменялось. */
  unchanged: number;
  updates: ImportUpdate[];
  skipped: { title: string; reason: string }[];
  preview: { title: string; priceRub: number; quantity: number | null; images: number }[];
}

const MAX_PRICE_RUB = 100_000_000;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Проверка одной строки из браузера: ничего не принимаем на веру. */
export function sanitizeItem(raw: unknown): { item: ImportItem } | { error: string; title: string } {
  if (!raw || typeof raw !== "object") return { error: "непонятная строка", title: "?" };
  const o = raw as Record<string, unknown>;
  const title = str(o.title, 300);
  if (title.length < 3) return { error: "название короче 3 символов", title: title || "?" };
  const priceRub = typeof o.priceRub === "number" ? o.priceRub : Number.NaN;
  if (!Number.isFinite(priceRub) || priceRub <= 0 || priceRub > MAX_PRICE_RUB) return { error: "цена не похожа на настоящую", title };
  const oldPriceRub = typeof o.oldPriceRub === "number" && Number.isFinite(o.oldPriceRub) && o.oldPriceRub > priceRub && o.oldPriceRub <= MAX_PRICE_RUB ? o.oldPriceRub : undefined;
  const quantity = typeof o.quantity === "number" && Number.isFinite(o.quantity) && o.quantity >= 0 ? Math.min(Math.floor(o.quantity), 1_000_000) : undefined;
  const images = Array.isArray(o.images)
    ? o.images.filter((u): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) && u.length <= 1000).slice(0, 10)
    : [];
  return {
    item: {
      article: str(o.article, 100),
      title,
      description: str(o.description, 4000),
      priceRub: Math.round(priceRub * 100) / 100,
      oldPriceRub,
      quantity,
      images,
      brand: str(o.brand, 100) || undefined,
      barcode: str(o.barcode, 50) || undefined,
    },
  };
}

/** Стабильный код товара: тот же артикул того же продавца даёт тот же код. */
export function importSku(sellerId: string, item: Pick<ImportItem, "article" | "title">): string {
  const key = item.article || item.title.toLowerCase();
  const hash = createHash("sha256").update(`${sellerId}:${key}`).digest("hex").slice(0, 10);
  const readable = slugify(item.article || item.title).slice(0, 30);
  return `imp-${readable}-${hash}`;
}

const EMPTY = { created: 0, wouldCreate: 0, updated: 0, wouldUpdate: 0, unchanged: 0, updates: [], preview: [] };

function rubOf(kopecks: number | undefined): number | undefined {
  return kopecks === undefined ? undefined : kopecks / 100;
}

export async function importCatalogItems(input: { sellerId: string; actorId: string; items: unknown; dryRun: boolean; verified: boolean }): Promise<ImportOutcome> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ...EMPTY, skipped: [{ title: "файл", reason: "в файле нет товаров" }] };
  }
  if (input.items.length > IMPORT_MAX_ITEMS) {
    return { ...EMPTY, skipped: [{ title: "файл", reason: `за раз можно загрузить до ${IMPORT_MAX_ITEMS} товаров, разделите файл` }] };
  }
  const skipped: ImportOutcome["skipped"] = [];
  const unique = new Map<string, ImportItem>();
  for (const raw of input.items) {
    const res = sanitizeItem(raw);
    if ("error" in res) { skipped.push({ title: res.title, reason: res.error }); continue; }
    const sku = importSku(input.sellerId, res.item);
    if (unique.has(sku)) { skipped.push({ title: res.item.title, reason: "повтор в файле" }); continue; }
    unique.set(sku, res.item);
  }
  // Уже перенесённые товары: не дублируем, а обновляем цену и остаток.
  const existing = await prisma.product.findMany({
    where: { sku: { in: [...unique.keys()] } },
    select: { id: true, sku: true, sellerId: true, title: true, status: true, priceKopecks: true, oldPriceKopecks: true, inventory: { select: { quantity: true } } },
  });
  const bulkItems: BulkItem[] = [];
  const current: BulkCurrent[] = [];
  for (const p of existing) {
    const item = unique.get(p.sku);
    unique.delete(p.sku);
    if (!item) continue;
    if (p.sellerId !== input.sellerId) { skipped.push({ title: item.title, reason: "код товара занят" }); continue; }
    current.push({ id: p.id, sku: p.sku, title: p.title, status: p.status, priceKopecks: p.priceKopecks, oldPriceKopecks: p.oldPriceKopecks, quantity: p.inventory?.quantity ?? 0 });
    bulkItems.push({ id: p.id, priceRub: item.priceRub, stockQuantity: item.quantity });
  }
  const plan = planBulk(current, bulkItems, { verified: input.verified });
  skipped.push(...plan.skipped);
  const unchanged = current.length - plan.changes.length;
  const updates: ImportUpdate[] = plan.changes.slice(0, 10).map((c) => ({
    title: c.title,
    priceFromRub: rubOf(c.priceFrom),
    priceToRub: rubOf(c.priceTo),
    stockFrom: c.stockFrom,
    stockTo: c.stockTo,
  }));

  const preview = [...unique.values()].slice(0, 10).map((i) => ({ title: i.title, priceRub: i.priceRub, quantity: i.quantity ?? null, images: i.images.length }));
  if (input.dryRun) {
    return { created: 0, wouldCreate: unique.size, updated: 0, wouldUpdate: plan.changes.length, unchanged, updates, skipped, preview };
  }

  let updated = 0;
  if (plan.changes.length > 0) {
    // Применяем только то, что реально меняется: те же проверки и журнал, что в массовом редактировании.
    const wanted = plan.changes.map((c) => ({ id: c.id, priceRub: c.priceTo === undefined ? undefined : c.priceTo / 100, stockQuantity: c.stockTo }));
    const result = await applyBulkUpdate({ sellerId: input.sellerId, actorId: input.actorId, verified: input.verified, items: wanted });
    updated = result.updated;
    skipped.push(...result.skipped);
  }

  let created = 0;
  for (const [sku, item] of unique) {
    try {
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            sellerId: input.sellerId,
            sku,
            title: item.title,
            description: item.description || null,
            attributes: JSON.stringify({
              ...(item.article ? { "Артикул продавца": item.article } : {}),
              ...(item.brand ? { "Бренд": item.brand } : {}),
              ...(item.barcode ? { "Штрихкод": item.barcode } : {}),
            }),
            keywords: JSON.stringify(item.brand ? [item.brand] : []),
            seoSlug: `${slugify(item.title).slice(0, 60)}-${sku.slice(-6)}`,
            priceKopecks: toKopecks(item.priceRub),
            oldPriceKopecks: item.oldPriceRub ? toKopecks(item.oldPriceRub) : null,
            status: "DRAFT",
            aiDraft: false,
            aiGeneratedFrom: "catalog-import",
          },
        });
        const quantity = item.quantity ?? 0;
        await tx.inventory.create({
          data: { productId: product.id, quantity, confirmedBySeller: false, availability: computeAvailability(quantity, false, null) },
        });
        if (item.images.length > 0) {
          await tx.productImage.createMany({
            data: item.images.map((url, position) => ({ productId: product.id, url, isPrimary: position === 0, position })),
          });
        }
        await tx.listingHistory.create({
          data: { productId: product.id, sellerId: input.sellerId, actorId: input.actorId, action: "CREATED", change: JSON.stringify({ priceRub: item.priceRub, quantity }), note: "импорт из файла" },
        });
      }, { maxWait: 15000, timeout: 15000 });
      created += 1;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      skipped.push({ title: item.title, reason: code === "P2002" ? "уже есть в магазине" : "не удалось сохранить, попробуйте ещё раз" });
    }
  }
  await audit({
    actorId: input.actorId,
    actorRole: "seller",
    action: "catalog.import",
    targetType: "seller",
    targetId: input.sellerId,
    after: { created, updated, skipped: skipped.length },
  });
  return { created, wouldCreate: unique.size, updated, wouldUpdate: plan.changes.length, unchanged, updates, skipped, preview };
}
