/**
 * Catalog tools: read-only search, comparison and product inspection.
 * These carry no state-change risk, so they never require confirmation.
 */
import { searchProducts, getPublicProduct, type SearchFilters } from "../../domains/catalog";
import { fromKopecks } from "../../utils";
import type { ToolDefinition, ToolResult, ToolContext } from "./registry";
import { looseObjectSchema } from "./registry";
import { recordEvent } from "../../domains/events";
import { prisma } from "../../prisma";

function ok(data: unknown, summary: string): ToolResult {
  return { ok: true, data, summary, verification: "VERIFIED" };
}

function asNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const searchProductsTool: ToolDefinition = {
  name: "search_products",
  description:
    "Гибридный поиск по каталогу: ключевое слово + семантика + структурные фильтры. Возвращает товары с рейтингом и сигналами.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    query: { type: "string", description: "текст запроса на естественном языке" },
    category: { type: "string" },
    maxPrice: { type: "number", description: "бюджет в рублях" },
    minRating: { type: "number" },
    availabilityOnly: { type: "boolean" },
    limit: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const filters: SearchFilters = {
      query: typeof args.query === "string" ? args.query : undefined,
      categorySlug: typeof args.category === "string" ? args.category : undefined,
      maxPrice: asNumber(args.maxPrice) ?? asNumber(args.budget),
      minRating: asNumber(args.minRating),
      availabilityOnly: Boolean(args.availabilityOnly),
      limit: Math.min(asNumber(args.limit) ?? 12, 24),
    };
    const { results, total, mode } = await searchProducts(filters, ctx.traceId);
    if (ctx.userId) {
      await recordEvent({
        userId: ctx.userId,
        type: "SEARCH",
        productId: undefined,
        payload: { query: filters.query, mode, resultCount: results.length },
      });
    }
    const summary =
      results.length > 0
        ? `Найдено ${total} предложений. Лучшее совпадение: «${results[0].product.title}» за ${fromKopecks(results[0].product.priceKopecks)} ₽.`
        : "По запросу ничего не найдено. Уточните категорию или бюджет.";
    return ok(
      {
        total,
        mode,
        items: results.map((r) => ({
          productId: r.product.id,
          title: r.product.title,
          priceKopecks: r.product.priceKopecks,
          rating: r.product.rating,
          seller: r.product.sellerProfile.displayName,
          availability: r.product.inventory?.availability ?? "UNKNOWN",
          signals: r.signals,
        })),
      },
      summary
    );
  },
};

export const searchCheaperTool: ToolDefinition = {
  name: "search_cheaper",
  description: "Найти более доступные аналоги: те же категории, цена ниже, рейтинг и доставка учитываются.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string" },
    maxPrice: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    let categorySlug: string | undefined;
    let refPrice: number | undefined;
    if (typeof args.productId === "string") {
      const ref = await prisma.product.findUnique({
        where: { id: args.productId },
        include: { category: true },
      });
      if (!ref) return { ok: false, error: "товар-ориентир не найден", verification: "NOT_PROVEN" };
      categorySlug = ref.category?.slug;
      refPrice = fromKopecks(ref.priceKopecks);
    }
    const { results } = await searchProducts(
      {
        categorySlug,
        maxPrice: asNumber(args.maxPrice) ?? (refPrice ? refPrice * 0.85 : undefined),
        sort: "price_asc",
        limit: 12,
      },
      ctx.traceId
    );
    return ok(
      results.map((r) => ({
        productId: r.product.id,
        title: r.product.title,
        priceKopecks: r.product.priceKopecks,
        rating: r.product.rating,
        seller: r.product.sellerProfile.displayName,
      })),
      results.length > 0
        ? `Нашёл ${results.length} более доступных вариантов.`
        : "Более доступных аналогов не нашлось."
    );
  },
};

export const compareProductsTool: ToolDefinition = {
  name: "compare_products",
  description:
    "Сравнить товары по цене, характеристикам, продавцу, рейтингу, наличию и доставке. Объясняет разницу простым языком.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productIds: { type: "array", items: { type: "string" } },
    query: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    let ids = Array.isArray(args.productIds) ? (args.productIds as string[]) : [];
    if (ids.length < 2 && typeof args.query === "string") {
      const { results } = await searchProducts({ query: args.query, limit: 4 }, ctx.traceId);
      ids = results.map((r) => r.product.id);
    }
    if (ids.length < 2) {
      return { ok: false, error: "для сравнения нужно минимум два товара", verification: "NOT_PROVEN" };
    }
    const products = await Promise.all(ids.slice(0, 6).map((id) => getPublicProduct(id)));
    const rows = products.filter(Boolean).map((p) => {
      const attrs = safeAttributes(p!.attributes);
      return {
        productId: p!.id,
        title: p!.title,
        priceKopecks: p!.priceKopecks,
        rating: p!.rating,
        reviewsCount: p!.reviewsCount,
        seller: p!.sellerProfile.displayName,
        availability: p!.inventory?.availability ?? "UNKNOWN",
        attributes: attrs,
      };
    });
    const prices = rows.map((r) => r.priceKopecks);
    const min = Math.min(...prices);
    const top = rows.find((r) => r.rating === Math.max(...rows.map((x) => x.rating)));
    const differences: string[] = [];
    differences.push(
      `Разброс цен: от ${fromKopecks(min)} до ${fromKopecks(Math.max(...prices))} ₽.`
    );
    if (top) differences.push(`Лучший рейтинг: «${top.title}» — ${top.rating.toFixed(1)}.`);
    const unconfirmed = rows.filter((r) => r.availability === "UNKNOWN");
    if (unconfirmed.length > 0) {
      differences.push(
        `${unconfirmed.length} из ${rows.length} предложений с неподтверждённым наличием — срок доставки не гарантирую.`
      );
    }
    return ok({ items: rows, differences }, differences.join(" "));
  },
};

function safeAttributes(raw: string | null | undefined): Record<string, unknown> {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const getProductTool: ToolDefinition = {
  name: "get_product",
  description: "Получить публичные данные карточки товара: характеристики, продавец, наличие, отзывы.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.productId !== "string") {
      return { ok: false, error: "укажите productId", verification: "NOT_PROVEN" };
    }
    const product = await getPublicProduct(args.productId);
    if (!product) return { ok: false, error: "товар не найден", verification: "NOT_PROVEN" };
    if (ctx.userId) {
      await recordEvent({
        userId: ctx.userId,
        type: "PRODUCT_VIEW",
        productId: product.id,
        payload: { title: product.title },
      });
    }
    return ok(
      {
        productId: product.id,
        title: product.title,
        priceKopecks: product.priceKopecks,
        seller: product.sellerProfile.displayName,
        availability: product.inventory?.availability ?? "UNKNOWN",
        attributes: safeAttributes(product.attributes),
      },
      `«${product.title}» за ${fromKopecks(product.priceKopecks)} ₽ от продавца ${product.sellerProfile.displayName}.`
    );
  },
};
