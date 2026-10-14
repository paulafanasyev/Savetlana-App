/**
 * Выгрузка товаров в формате YML (Яндекс.Товары, Яндекс.Маркет, Яндекс.Директ).
 *
 * В выгрузку попадают только опубликованные товары с ценой и хотя бы одним фото
 * с полным https-адресом: без фото Яндекс карточку всё равно отклонит. Товары
 * без остатка идут с available="false", чтобы Яндекс снял их с показа, а не
 * считал пропавшими.
 */
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { SITE_NAME, absoluteImage, inStock, siteUrl } from "./seo";

export const YML_MAX_OFFERS = 20_000;

export interface YmlCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export interface YmlProduct {
  id: string;
  title: string;
  description: string | null;
  sku: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  categoryId: string | null;
  attributes: string;
  images: { url: string }[];
  inventory: { quantity: number; availability: string } | null;
}

/** Убирает символы, которые ломают XML (управляющие коды). */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.split(String.fromCharCode(0)).join("").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");
}

export function xmlEscape(text: string): string {
  return clean(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Описание в CDATA: «]]>» внутри текста разбивается, иначе блок закроется раньше времени. */
export function cdata(text: string): string {
  return `<![CDATA[${clean(text).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/**
 * Числовой номер категории для YML. Яндекс ждёт целое число, а у нас cuid.
 * Номер получается из самого id, поэтому не меняется, когда добавляются новые категории.
 */
export function ymlCategoryId(id: string): string {
  return String(parseInt(createHash("sha1").update(id).digest("hex").slice(0, 12), 16));
}

function price(kopecks: number): string {
  return (kopecks / 100).toFixed(2).replace(/\.00$/, "");
}

function attr(attributes: string, ...keys: string[]): string | undefined {
  try {
    const parsed = JSON.parse(attributes) as Record<string, unknown>;
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    /* битые характеристики просто пропускаем */
  }
  return undefined;
}

/** Дата в формате, который принимает Яндекс: 2026-10-14T18:00+03:00. */
function ymlDate(date: Date): string {
  const msk = new Date(date.getTime() + 3 * 3600_000);
  return `${msk.toISOString().slice(0, 16)}+03:00`;
}

export function buildYml(input: { categories: YmlCategory[]; products: YmlProduct[]; now?: Date }): { xml: string; offers: number; skipped: number } {
  const known = new Map(input.categories.map((c) => [c.id, c]));
  const used = new Set<string>();
  const offers: string[] = [];
  let skipped = 0;

  for (const product of input.products) {
    const pictures = product.images.map((i) => absoluteImage(i.url)).filter((u): u is string => Boolean(u)).slice(0, 10);
    if (product.priceKopecks < 100 || pictures.length === 0 || !product.categoryId || !known.has(product.categoryId)) {
      skipped += 1;
      continue;
    }
    for (let id: string | null = product.categoryId; id && !used.has(id); id = known.get(id)?.parentId ?? null) used.add(id);

    const lines = [
      `<offer id="${xmlEscape(product.id)}" available="${inStock(product) ? "true" : "false"}">`,
      `<url>${xmlEscape(siteUrl(`/product/${product.id}`))}</url>`,
      `<price>${price(product.priceKopecks)}</price>`,
    ];
    if (product.oldPriceKopecks && product.oldPriceKopecks > product.priceKopecks) lines.push(`<oldprice>${price(product.oldPriceKopecks)}</oldprice>`);
    lines.push(`<currencyId>RUR</currencyId>`, `<categoryId>${ymlCategoryId(product.categoryId)}</categoryId>`);
    for (const picture of pictures) lines.push(`<picture>${xmlEscape(picture)}</picture>`);
    lines.push(`<name>${xmlEscape(product.title.slice(0, 150))}</name>`);
    const vendor = attr(product.attributes, "Бренд", "Производитель");
    if (vendor) lines.push(`<vendor>${xmlEscape(vendor)}</vendor>`);
    lines.push(`<vendorCode>${xmlEscape(attr(product.attributes, "Артикул продавца", "Артикул") ?? product.sku)}</vendorCode>`);
    if (product.description?.trim()) lines.push(`<description>${cdata(product.description.slice(0, 3000))}</description>`);
    lines.push(`<count>${Math.max(0, product.inventory?.quantity ?? 0)}</count>`, `</offer>`);
    offers.push(lines.join(""));
  }

  const categories = input.categories
    .filter((c) => used.has(c.id))
    .map((c) => {
      const parent = c.parentId && used.has(c.parentId) ? ` parentId="${ymlCategoryId(c.parentId)}"` : "";
      return `<category id="${ymlCategoryId(c.id)}"${parent}>${xmlEscape(c.name)}</category>`;
    });

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<yml_catalog date="${ymlDate(input.now ?? new Date())}">`,
    `<shop>`,
    `<name>${xmlEscape(SITE_NAME)}</name>`,
    `<company>${xmlEscape(SITE_NAME)}</company>`,
    `<url>${xmlEscape(siteUrl("/"))}</url>`,
    `<currencies><currency id="RUR" rate="1"/></currencies>`,
    `<categories>${categories.join("")}</categories>`,
    `<offers>`,
    ...offers,
    `</offers>`,
    `</shop>`,
    `</yml_catalog>`,
  ].join("\n");
  return { xml, offers: offers.length, skipped };
}

/** Товары всей площадки или одного продавца (sellerId). */
export async function loadYmlInput(sellerId?: string): Promise<{ categories: YmlCategory[]; products: YmlProduct[] }> {
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
    prisma.product.findMany({
      where: { status: "ACTIVE", ...(sellerId ? { sellerId } : {}) },
      select: {
        id: true,
        title: true,
        description: true,
        sku: true,
        priceKopecks: true,
        oldPriceKopecks: true,
        categoryId: true,
        attributes: true,
        images: { orderBy: { position: "asc" }, take: 10, select: { url: true } },
        inventory: { select: { quantity: true, availability: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: YML_MAX_OFFERS,
    }),
  ]);
  return { categories, products };
}