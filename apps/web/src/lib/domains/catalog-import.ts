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
 *    превращается в стабильный код товара, уже существующие пропускаются.
 */
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { slugify, toKopecks } from "../utils";
import { computeAvailability } from "./inventory";
import { audit } from "./audit";
import { IMPORT_MAX_ITEMS, type ImportItem } from "../catalog-import-parse";

export interface ImportOutcome {
  created: number;
  wouldCreate: number;
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

export async function importCatalogItems(input: { sellerId: string; actorId: string; items: unknown; dryRun: boolean }): Promise<ImportOutcome> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { created: 0, wouldCreate: 0, skipped: [{ title: "файл", reason: "в файле нет товаров" }], preview: [] };
  }
  if (input.items.length > IMPORT_MAX_ITEMS) {
    return { created: 0, wouldCreate: 0, skipped: [{ title: "файл", reason: `за раз можно загрузить до ${IMPORT_MAX_ITEMS} товаров, разделите файл` }], preview: [] };
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
  const existing = await prisma.product.findMany({ where: { sku: { in: [...unique.keys()] } }, select: { sku: true } });
  for (const { sku } of existing) {
    const item = unique.get(sku);
    if (item) skipped.push({ title: item.title, reason: "уже есть в магазине" });
    unique.delete(sku);
  }
  const preview = [...unique.values()].slice(0, 10).map((i) => ({ title: i.title, priceRub: i.priceRub, quantity: i.quantity ?? null, images: i.images.length }));
  if (input.dryRun) return { created: 0, wouldCreate: unique.size, skipped, preview };

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
    after: { created, skipped: skipped.length },
  });
  return { created, wouldCreate: unique.size, skipped, preview };
}
