/**
 * Seller tools: analytics, inventory, listing lifecycle, AI product drafts,
 * pricing advice and competitor intelligence.
 *
 * Every mutating tool here is seller-scoped: the tool context's
 * sellerProfileId is checked against the product's owner, so one seller can
 * never act on another's catalog (spec §38, §39).
 */
import { sellerReport, productHealth, parseWorkflowRule, saveWorkflowRule } from "../../domains/seller-analytics";
import { confirmAvailability, extendListing } from "../../domains/inventory";
import { adviseOnPrice, applyPriceChange, priceHistory } from "../../domains/pricing";
import { findCompetitors, findCompetitorSellers } from "../../domains/competitors";
import { scanExternalCompetitors, searchGlobally } from "../../domains/external-search";
import { quoteDeliveryTier, type DeliveryTier } from "../../delivery-tiers";
import type { ScanTier } from "../../marketplaces";
import { requirementsForSeller } from "../../domains/documents";
import { prisma } from "../../prisma";
import { fromKopecks, slugify, toKopecks } from "../../utils";
import type { ToolDefinition, ToolResult, ToolContext } from "./registry";
import { looseObjectSchema } from "./registry";
import { audit } from "../../domains/audit";

function ok(data: unknown, summary: string): ToolResult {
  return { ok: true, data, summary, verification: "VERIFIED" };
}
function denied(reason: string): ToolResult {
  return { ok: false, error: reason, verification: "NOT_PROVEN" };
}

interface OwnedProduct {
  id: string;
  sellerId: string;
  title: string;
  priceKopecks: number;
  status: string;
}

async function ownProduct(
  ctx: ToolContext,
  productId: string
): Promise<{ product: OwnedProduct } | { error: string }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sellerId: true, title: true, priceKopecks: true, status: true },
  });
  if (!product) return { error: "товар не найден" };
  if (product.sellerId !== ctx.sellerProfileId) return { error: "товар принадлежит другому продавцу" };
  return { product };
}

function requireSeller(ctx: ToolContext): string | ToolResult {
  return ctx.sellerProfileId ?? denied("нужен кабинет продавца");
}

function productIdArg(args: Record<string, unknown>): string | undefined {
  return typeof args.productId === "string" && args.productId.length > 0
    ? args.productId
    : undefined;
}

export const analyzeSellerSalesTool: ToolDefinition = {
  name: "analyze_seller_sales",
  description:
    "Диагностика продаж продавца: «почему упали продажи?». Анализирует трафик, конверсию, цену, конкурентов, отзывы, наличие.",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const report = await sellerReport(sellerId);
    const causes =
      report.salesDropCauses.length > 0
        ? report.salesDropCauses
        : ["спада по данным не зафиксировано"];
    const topRecs = report.recommendations
      .slice(0, 4)
      .map((r) => `${r.text} (основание: ${r.evidence})`);
    return ok(
      {
        totals: report.totals,
        causes,
        recommendations: topRecs,
        lowStock: report.lowStock,
        staleListings: report.stale,
        worstHealth: report.health
          .filter((h) => h.issues.length > 0)
          .sort((a, b) => a.healthScore - b.healthScore)
          .slice(0, 5),
      },
      `Анализ готов. ${causes[0]} Рекомендаций: ${topRecs.length}.`
    );
  },
};

export const confirmInventoryTool: ToolDefinition = {
  name: "confirm_inventory",
  description:
    "Подтвердить наличие товара и продлить срок продажи. Требует подтверждения продавца — это коммерческое действие.",
  permission: "CONFIRM_INVENTORY",
  riskLevel: "HIGH_RISK_WRITE",
  needsConfirmation: true,
  parameters: looseObjectSchema({
    productId: { type: "string" },
    quantity: { type: "number" },
    extendDays: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    let productId = productIdArg(args);
    if (!productId) {
      // "confirm availability" without a specific product: confirm the
      // stalest active listing whose confirmation is missing or expired.
      // The result names exactly which product was touched.
      const stale = await prisma.product.findFirst({
        where: { sellerId, status: "ACTIVE" },
        include: { inventory: true, listing: true },
        orderBy: { updatedAt: "asc" },
      });
      if (!stale) return denied("у вас нет активных товаров для подтверждения наличия");
      const inv = stale.inventory;
      const expired = inv?.saleUntil ? inv.saleUntil < new Date() : true;
      if (inv?.confirmedBySeller && !expired) {
        return denied("все ваши активные товары уже имеют подтверждённое наличие — укажите productId, если нужно обновить конкретный товар");
      }
      productId = stale.id;
    }
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);

    const quantity =
      typeof args.quantity === "number" && args.quantity >= 0
        ? Math.floor(args.quantity)
        : undefined;
    const result = await confirmAvailability(productId, ctx.userId, {
      sellerId,
      quantity,
      extendDays: typeof args.extendDays === "number" ? args.extendDays : undefined,
    });
    return ok(
      result,
      `Наличие подтверждено: ${result.availability}, количество ${result.quantity}. Размещение продлено до ${result.saleUntil.toLocaleDateString("ru-RU")}.`
    );
  },
};

export const extendListingTool: ToolDefinition = {
  name: "extend_listing",
  description: "Продлить срок размещения товара без изменения количества.",
  permission: "EXTEND_LISTING",
  riskLevel: "LOW_RISK_WRITE",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" }, extendDays: { type: "number" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const productId = productIdArg(args);
    if (!productId) return denied("укажите productId");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);
    const result = await extendListing(productId, ctx.userId, {
      extendDays: typeof args.extendDays === "number" ? args.extendDays : undefined,
      sellerId,
    });
    return ok(result, `Размещение продлено до ${result.expiresAt.toLocaleDateString("ru-RU")}.`);
  },
};

export const createProductDraftTool: ToolDefinition = {
  name: "create_product_draft",
  description:
    "Создать черновик карточки товара. Публикация остаётся за продавцом — черновик не виден покупателям.",
  permission: "CREATE_PRODUCT_DRAFT",
  riskLevel: "LOW_RISK_WRITE",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    title: { type: "string" },
    categorySlug: { type: "string" },
    priceRub: { type: "number" },
    description: { type: "string" },
    attributes: { type: "object" },
    keywords: { type: "array", items: { type: "string" } },
    imageUrl: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const title = typeof args.title === "string" && args.title.trim().length > 2 ? args.title.trim() : null;
    if (!title) return denied("не удалось определить название товара — укажите его явно");
    const priceRub = typeof args.priceRub === "number" && args.priceRub > 0 ? args.priceRub : null;

    const category =
      typeof args.categorySlug === "string"
        ? await prisma.category.findUnique({ where: { slug: args.categorySlug } })
        : null;

    const sku = "AI-" + slugify(title).slice(0, 20) + "-" + Math.random().toString(36).slice(2, 8);
    const draft = await prisma.product.create({
      data: {
        sellerId,
        categoryId: category?.id ?? null,
        sku,
        title,
        description: typeof args.description === "string" ? args.description.slice(0, 4000) : null,
        attributes: JSON.stringify((args.attributes as Record<string, unknown> | undefined) ?? {}),
        keywords: JSON.stringify(
          Array.isArray(args.keywords) ? (args.keywords as unknown[]).slice(0, 30) : []
        ),
        seoSlug: slugify(title) + "-" + Math.random().toString(36).slice(2, 6),
        priceKopecks: priceRub ? toKopecks(priceRub) : 0,
        status: "DRAFT",
        aiDraft: true,
        aiGeneratedFrom: "seller-photo-assistant",
        requiresDocuments: Boolean(category),
      },
    });
    if (typeof args.imageUrl === "string") {
      await prisma.productImage.create({
        data: { productId: draft.id, url: args.imageUrl, isPrimary: true, position: 0 },
      });
    }
    await prisma.listingHistory.create({
      data: {
        productId: draft.id,
        sellerId,
        action: "AI_DRAFT_CREATED",
        change: JSON.stringify({ title, priceRub, aiDraft: true }),
        actorId: ctx.userId,
      },
    });
    await audit({
      actorId: ctx.userId,
      actorRole: "seller",
      action: "product.ai_draft_created",
      targetType: "product",
      targetId: draft.id,
      after: { title, priceRub },
    });
    return ok(
      {
        productId: draft.id,
        sku: draft.sku,
        title: draft.title,
        priceKopecks: draft.priceKopecks,
        status: draft.status,
        needsSellerApproval: true,
      },
      `Черновик «${title}» создан. Цена ${priceRub ? priceRub + " ₽" : "не указана"}. Публикация — за вами.`
    );
  },
};

export const publishProductTool: ToolDefinition = {
  name: "publish_product",
  description: "Опубликовать карточку товара (только после одобрения продавца).",
  permission: "PUBLISH_PRODUCT",
  riskLevel: "HIGH_RISK_WRITE",
  needsConfirmation: true,
  parameters: looseObjectSchema({ productId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const productId = productIdArg(args);
    if (!productId) return denied("укажите productId");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);
    if (owned.product.status === "ARCHIVED") return denied("товар архивирован");

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { status: "ACTIVE" },
    });
    await prisma.listing.upsert({
      where: { productId },
      create: { productId, publishedAt: new Date(), isLive: true },
      update: { publishedAt: new Date(), isLive: true },
    });
    await prisma.listingHistory.create({
      data: { productId, sellerId, action: "PUBLISHED", actorId: ctx.userId },
    });
    return ok(
      { productId: updated.id, status: updated.status },
      `Карточка «${updated.title}» опубликована и видна покупателям.`
    );
  },
};

export const changePriceTool: ToolDefinition = {
  name: "change_price",
  description:
    "Изменить цену товара. Требует подтверждения продавца. Рекомендация Pricing Agent — это совет, а не автоматическое действие.",
  permission: "CHANGE_PRICE",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({ productId: { type: "string" }, newPriceRub: { type: "number" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const productId = productIdArg(args);
    const newPriceRub = typeof args.newPriceRub === "number" ? args.newPriceRub : undefined;
    if (!productId || !newPriceRub || newPriceRub <= 0) return denied("укажите productId и новую цену");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);
    const updated = await applyPriceChange({
      productId,
      sellerId,
      newPriceKopecks: toKopecks(newPriceRub),
      actorId: ctx.userId,
      actorRole: "seller",
      confirmed: true,
    });
    return ok(
      { productId: updated.id, priceKopecks: updated.priceKopecks },
      `Цена изменена на ${fromKopecks(updated.priceKopecks)} ₽.`
    );
  },
};

export const advisePriceTool: ToolDefinition = {
  name: "advise_price",
  description: "Дать обоснованный совет по цене товара на основе рыночных данных.",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    requireSeller(ctx);
    const productId = productIdArg(args);
    if (!productId) return denied("укажите productId");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);
    const advice = await adviseOnPrice(productId);
    return ok(
      {
        direction: advice.direction,
        currentPriceKopecks: advice.position.ownPriceKopecks,
        marketMedianKopecks: advice.position.marketMedian,
        suggestedPriceKopecks: advice.suggestedPriceKopecks,
        percentile: advice.position.percentile,
        reasoning: advice.reasoning,
        requiresConfirmation: advice.requiresConfirmation,
      },
      advice.reasoning.join(" ")
    );
  },
};

export const priceHistoryTool: ToolDefinition = {
  name: "price_history",
  description: "История изменения цены товара из журнала размещений.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    requireSeller(ctx);
    const productId = productIdArg(args);
    if (!productId) return denied("укажите productId");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);
    const history = await priceHistory(productId);
    return ok(
      { points: history },
      history.length > 1
        ? `Изменений цены: ${history.length - 1}. Текущая: ${fromKopecks(history[history.length - 1].priceKopecks)} ₽.`
        : "Цена не менялась с момента создания карточки."
    );
  },
};

export const findCompetitorsTool: ToolDefinition = {
  name: "find_competitors",
  description:
    "Найти конкурирующие предложения по публичным данным каталога. Без доступа к чужим закрытым кабинетам.",
  permission: "READ_SELLERS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" }, scope: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const scope = typeof args.scope === "string" ? args.scope : "catalog";
    const productId = productIdArg(args);

    if (productId) {
      const owned = await ownProduct(ctx, productId);
      if (!("error" in owned)) {
        const report = await findCompetitors(productId);
        return ok(
          {
            ownPriceKopecks: report.ownPriceKopecks,
            offers: report.offers,
            cheaperCount: report.cheaperCount,
            gaps: report.gaps,
          },
          report.gaps.length > 0
            ? `Конкурентов: ${report.offers.length}. Что улучшить: ${report.gaps[0]}`
            : `Конкурентов: ${report.offers.length}.`
        );
      }
    }
    const competitors = await findCompetitorSellers(sellerId, 15);
    return ok(
      { competitors, scope },
      `Сопоставимых продавцов в ваших категориях: ${competitors.length}.`
    );
  },
};

export const productHealthTool: ToolDefinition = {
  name: "product_health",
  description:
    "Health report карточки: фотографии, характеристики, описание, поисковая пригодность, наличие, отзывы.",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    requireSeller(ctx);
    const productId = productIdArg(args);
    if (!productId) return denied("укажите productId");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);
    const health = await productHealth(productId);
    return ok(
      health,
      `Health score: ${health.healthScore}/100. ${
        health.issues.length === 0
          ? "Проблем не нашёл."
          : "Что исправить: " + health.issues[0]
      }`
    );
  },
};

export const documentRequirementsTool: ToolDefinition = {
  name: "document_requirements",
  description: "Какие документы нужны продавцу для его категорий товаров.",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const reqs = await requirementsForSeller(sellerId);
    return ok(
      reqs,
      reqs.missing.length === 0
        ? "Все обязательные документы загружены."
        : `Не хватает документов: ${reqs.missing.join(", ")}.`
    );
  },
};

export const createWorkflowRuleTool: ToolDefinition = {
  name: "create_workflow_rule",
  description:
    "Создать правило автоматизации из естественного языка: «если наличие истекает — напомни мне».",
  permission: "READ_ANALYTICS",
  riskLevel: "LOW_RISK_WRITE",
  needsConfirmation: false,
  parameters: looseObjectSchema({ text: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const text = typeof args.text === "string" ? args.text : "";
    if (text.length < 5) return denied("опишите правило подробнее");
    const rule = parseWorkflowRule(text);
    if (!rule) {
      return denied(
        "не удалось разобрать правило. Поддерживаемые триггеры: наличие/остатки, истечение размещения, новые отзывы, цены конкурентов."
      );
    }
    const saved = await saveWorkflowRule(sellerId, rule, true);
    return ok(
      { ruleId: saved.id, trigger: saved.trigger, action: saved.action },
      `Правило создано: триггер «${saved.trigger}», действие «${saved.action}».`
    );
  },
};

export const scanGlobalCompetitorsTool: ToolDefinition = {
  name: "scan_global_competitors",
  description:
    "Анализ конкурентов глобально по всему интернету, не только внутри платформы. Уровень 1 — Россия (Ozon, Wildberries), уровень 2 — глобально (AliExpress, Taobao, Amazon).",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string" },
    tier: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = requireSeller(ctx);
    if (typeof sellerId !== "string") return sellerId;
    const productId = productIdArg(args);
    if (!productId) return denied("укажите productId вашего товара");
    const owned = await ownProduct(ctx, productId);
    if ("error" in owned) return denied(owned.error);

    const tier: ScanTier = args.tier === 2 ? 2 : 1;
    const scan = await scanExternalCompetitors(productId, { tier });

    const reachable = scan.marketplaces.filter((m) => m.status === "OK");
    const unreachable = scan.marketplaces.filter(
      (m) => m.status === "UNREACHABLE" || m.status === "BLOCKED",
    );
    const scope =
      tier === 2
        ? "глобально (AliExpress, Taobao, Amazon)"
        : "Россия (Ozon, Wildberries + платформа)";
    return ok(
      {
        tier,
        scope,
        liveExternal: scan.liveExternal,
        minExternalPriceKopecks: scan.minExternalPrice,
        cheaperCount: scan.cheaperCount,
        offers: scan.verifiedOffers.slice(0, 10),
        marketplaces: scan.marketplaces.map((m) => ({
          key: m.key,
          status: m.status,
          confidence: m.confidence,
          offers: m.offers.length,
        })),
        unreachable: unreachable.map((m) => m.key),
        verdict: scan.verdict,
      },
      reachable.length === 0
        ? `Уровень ${tier} (${scope}): внешние площадки недоступны — PENDING_EXTERNAL_ACCESS. ${scan.verdict}`
        : `Уровень ${tier} (${scope}): проверено ${reachable.length} площадок, найдено ${scan.verifiedOffers.length} предложений. ${scan.verdict}` +
            (unreachable.length ? ` Недоступно: ${unreachable.map((m) => m.key).join(", ")}.` : "")
    );
  },
};

export const globalSearchTool: ToolDefinition = {
  name: "global_search",
  description:
    "Глобальный поиск товара по всему интернету: платформа + внешние маркетплейсы. Уровень 1 — Россия, уровень 2 — глобально.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    query: { type: "string" },
    tier: { type: "number" },
    maxPrice: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.query !== "string" || args.query.trim().length < 2)
      return denied("укажите поисковый запрос");
    const tier: ScanTier = args.tier === 2 ? 2 : 1;
    const maxPriceKopecks =
      typeof args.maxPrice === "number" && Number.isFinite(args.maxPrice)
        ? Math.round(args.maxPrice * 100)
        : undefined;

    const report = await searchGlobally(
      { text: args.query.trim(), limit: 15, maxPriceKopecks },
      tier,
    );
    const external = report.hits.filter((h) => h.source === "external");
    return ok(
      {
        tier,
        scope: report.tierLabel,
        platformCount: report.bySource.platform,
        externalCount: report.bySource.external,
        liveExternal: report.liveExternal,
        hits: report.hits.slice(0, 15),
        availability: report.availability,
        warnings: report.warnings,
      },
      `Уровень ${tier} (${report.tierLabel}): платформа ${report.bySource.platform}, внешние ${report.bySource.external}.` +
        (report.liveExternal ? " Внешние площадки ответили." : " Внешние площадки недоступны (PENDING_EXTERNAL_ACCESS).") +
        (external.length ? ` Самое дешёвое: ${external[0].title} — ${fromKopecks(external[0].priceKopecks)} ₽.` : "")
    );
  },
};

export const deliveryQuotesTool: ToolDefinition = {
  name: "delivery_quotes",
  description:
    "Котировки доставки по уровням: 1 — платформа (реальные услуги исполняются, средняя цена по России), 2 — все существующие компании, 3 — международная доставка.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    tier: { type: "number" },
    weightGrams: { type: "number" },
    city: { type: "string" },
    countryCode: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const tier = args.tier === 3 ? 3 : args.tier === 2 ? 2 : 1;
    const weightGrams =
      typeof args.weightGrams === "number" && Number.isFinite(args.weightGrams)
        ? args.weightGrams
        : undefined;
    const city = typeof args.city === "string" && args.city.trim() ? args.city.trim() : undefined;
    const countryCode =
      typeof args.countryCode === "string" && args.countryCode.trim()
        ? args.countryCode.trim()
        : undefined;

    const report = await quoteDeliveryTier(tier as DeliveryTier, {
      weightGrams,
      city,
      countryCode,
    });
    const priced = report.quotes.filter((q) => q.kopecks !== null);
    const pending = report.quotes.filter((q) => q.kopecks === null);
    const cheapest = priced.length ? priced.reduce((a, b) => (a.kopecks! < b.kopecks! ? a : b)) : null;

    return ok(
      {
        tier: report.tier,
        tierName: report.tierName,
        liveCount: report.liveCount,
        quotes: report.quotes,
      },
      `Уровень ${tier} (${report.tierName}): ${priced.length} перевозчиков с живой ценой, ${pending.length} ожидают доступ.` +
        (cheapest
          ? ` Самый дешёвый — ${cheapest.name}: ${fromKopecks(cheapest.kopecks!)} ₽ (${cheapest.days} дн.).`
          : pending.length
            ? ` Требуются credentials: ${pending.map((q) => q.needsCredential).filter(Boolean).join(", ")}.`
            : " Нет доступных котировок.")
    );
  },
};
