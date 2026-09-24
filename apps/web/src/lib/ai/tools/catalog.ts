/**
 * Catalog tools: read-only search, comparison and product inspection.
 * These carry no state-change risk, so they never require confirmation.
 */
import { searchProducts, getPublicProduct, type SearchFilters } from "../../domains/catalog";
import { summarizeReviews, listReviews } from "../../domains/reviews";
import { getPublicSellerProfile } from "../../domains/sellers";
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

/**
 * Vision search from conversation (spec §6). The user describes a photo they
 * uploaded, or references a recognised label; the tool runs the same vector
 * pipeline as the photo endpoint. Results always carry an honesty status.
 */
export const visionSearchTool: ToolDefinition = {
  name: "vision_search",
  description:
    "Поиск по фотографии: распознанный объект → векторный поиск по каталогу → ранжирование. Используй, когда пользователь описывает фотографию товара.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    label: { type: "string", description: "что распознано на фотографии" },
    limit: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const label = typeof args.label === "string" ? args.label.trim() : "";
    if (!label) {
      return {
        ok: false,
        error: "не удалось распознать объект на фотографии — опишите товар словами",
        verification: "NOT_PROVEN",
      };
    }
    // Reuse the vector layer: embed the recognised label the same way the
    // photo pipeline does, then rank the catalog.
    const { aiGateway, newTraceId } = await import("../../ai/gateway");
    const { getProductEmbedding, cosine } = await import("../../domains/catalog");
    const trace = newTraceId("embed");
    const queryVec = (await aiGateway.embed({ texts: [label], traceId: trace })).vectors[0];

    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: {
        sellerProfile: { select: { displayName: true } },
        inventory: { select: { availability: true } },
      },
      take: 500,
    });
    const scored = await Promise.all(
      products.map(async (product) => {
        const vec = await getProductEmbedding(product, trace);
        return { product, similarity: vec ? cosine(queryVec, vec) : 0 };
      }),
    );
    scored.sort((a, b) => b.similarity - a.similarity);
    const limit = Math.min(asNumber(args.limit) ?? 8, 16);
    const candidates = scored
      .filter((s) => s.similarity > 0.05)
      .slice(0, limit)
      .map((s, idx) => ({
        productId: s.product.id,
        title: s.product.title,
        priceKopecks: s.product.priceKopecks,
        seller: s.product.sellerProfile.displayName,
        availability: s.product.inventory?.availability ?? "UNKNOWN",
        similarity: Math.round(s.similarity * 100) / 100,
        match: idx === 0 ? "exact" : idx < 3 ? "similar" : "related",
      }));

    if (candidates.length === 0) {
      return {
        ok: true,
        data: { label, candidates: [] },
        summary: `Распознано «${label}», но похожих товаров в каталоге пока нет.`,
        // The recognition came from the sandbox vision provider.
        verification: "MOCK_VERIFIED",
      };
    }
    return {
      ok: true,
      data: { label, candidates },
      summary: `Распознано «${label}». Лучшее совпадение: «${candidates[0].title}» за ${fromKopecks(candidates[0].priceKopecks)} ₽.`,
      verification: "MOCK_VERIFIED",
    };
  },
};

/**
 * get_reviews (spec §14, §44) — AI-анализ отзывов: тональность, повторяющиеся
 * преимущества и жалобы, распределение оценок. Все выводы strictly основаны
 * на доступных отзывах, никаких выдуманных тем (spec §58).
 */
export const getReviewsTool: ToolDefinition = {
  name: "get_reviews",
  description:
    "Анализ отзывов на товар: тональность, повторяющиеся преимущества и жалобы, средний рейтинг. Покупателю — что чаще отмечают, продавцу — что исправить.",
  permission: "READ_REVIEWS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string", description: "идентификатор товара" },
    query: { type: "string", description: "поисковый запрос, если productId неизвестен" },
    limit: { type: "number", description: "сколько свежих отзывов показать" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    let productId = typeof args.productId === "string" ? args.productId : undefined;
    // Natural-language requests rarely carry an id: resolve the best-matching
    // product through the catalog search, same approach as compare_products.
    if (!productId && typeof args.query === "string" && args.query.trim()) {
      const { results } = await searchProducts({ query: args.query, limit: 1 }, ctx.traceId);
      productId = results[0]?.product.id;
    }
    if (!productId) return { ok: false, error: "не удалось определить товар — уточните название", verification: "NOT_PROVEN" };

    const summary = await summarizeReviews(productId);
    const fresh = await listReviews(productId, Math.min(asNumber(args.limit) ?? 5, 10));

    if (summary.count === 0) {
      return ok(
        { count: 0, reviews: [] },
        "На этот товар ещё нет отзывов. Оценить его по отзывам невозможно — это нужно честно сказать покупателю."
      );
    }

    const parts: string[] = [
      `Отзывов: ${summary.count}, средний рейтинг: ${summary.averageRating.toFixed(1)} из 5 (${summary.sentiment.toLowerCase()}).`,
    ];
    if (summary.topAdvantages.length > 0) {
      parts.push(`Чаще хвалят: ${summary.topAdvantages.slice(0, 3).join(", ")}.`);
    }
    if (summary.topComplaints.length > 0) {
      parts.push(`Чаще жалуются на: ${summary.topComplaints.slice(0, 3).join(", ")}.`);
    }
    return ok({ ...summary, reviews: fresh }, parts.join(" "));
  },
};

/**
 * search_sellers (spec §44, §61) — поиск продавцов по публичным данным.
 * Показывает верификацию, рейтинг и количество завершённых заказов, чтобы
 * покупатель мог оценить доверие (spec §41).
 */
export const searchSellersTool: ToolDefinition = {
  name: "search_sellers",
  description:
    "Поиск продавцов по названию или slug. Возвращает публичный профиль: верификацию, рейтинг, отзывы, историю работы на платформе.",
  permission: "READ_SELLERS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    query: { type: "string", description: "название или идентификатор продавца" },
  }),
  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { ok: false, error: "укажите запрос для поиска продавца", verification: "NOT_PROVEN" };

    const sellers = await prisma.sellerProfile.findMany({
      where: {
        isActivated: true,
        OR: [{ displayName: { contains: query } }, { slug: { contains: query } }],
      },
      take: 10,
      select: { id: true, slug: true, displayName: true, sellerType: true },
    });

    if (sellers.length === 0) {
      return ok({ items: [] }, `Продавцы «${query}» не найдены.`);
    }

    const profiles = await Promise.all(
      sellers.map((s) => getPublicSellerProfile(s.slug).catch(() => null))
    );
    const items = profiles.filter(Boolean).map((p) => ({
      id: p!.id,
      slug: p!.slug,
      displayName: p!.displayName,
      sellerType: p!.sellerType,
      identityStatus: p!.identityStatus,
      businessStatus: p!.businessStatus,
      npdStatus: p!.npdStatus,
      rating: p!.stats.rating,
      reviewsCount: p!.stats.reviewsCount,
      completedOrders: p!.stats.completedOrders,
      productsPublished: p!.stats.productsPublished,
    }));

    return ok(
      { items },
      items.length > 0
        ? `Найдено продавцов: ${items.length}. «${items[0].displayName}» — рейтинг ${items[0].rating}, завершённых заказов: ${items[0].completedOrders}.`
        : `Продавцы «${query}» не найдены.`
    );
  },
};
