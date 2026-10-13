/**
 * Tool registry bootstrap.
 *
 * Every tool the platform exposes is registered here exactly once. Agents ask
 * the registry (never the domain layer directly), so authorization,
 * confirmation gating and audit logging are uniformly enforced (spec §44).
 */
import { toolRegistry } from "./registry";
import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { prisma } from "../../prisma";
import { publishProblems, publishProblemsMessage } from "../../domains/publish-check";
import { getSellerOnboardingGate } from "../../domains/seller-onboarding";
import { searchProducts } from "../../domains/catalog";

import {
  searchProductsTool,
  searchCheaperTool,
  compareProductsTool,
  getProductTool,
  visionSearchTool,
  getReviewsTool,
  searchSellersTool,
  searchClassifiedsTool,
  vinCheckTool,
} from "./catalog";
import {
  getOrderTool,
  cartAddTool,
  createOrderTool,
  cancelOrderTool,
  wishlistAddTool,
  requestReturnTool,
  createDisputeTool,
  getTrackingTool,
  getPaymentStatusTool,
  checkInventoryTool,
} from "./commerce";
import {
  analyzeSellerSalesTool,
  confirmInventoryTool,
  extendListingTool,
  createProductDraftTool,
  publishProductTool,
  changePriceTool,
  advisePriceTool,
  priceHistoryTool,
  findCompetitorsTool,
  scanGlobalCompetitorsTool,
  globalSearchTool,
  deliveryQuotesTool,
  productHealthTool,
  documentRequirementsTool,
  createWorkflowRuleTool,
} from "./seller";
import {
  planGiftTool,
  upcomingEventsTool,
  giftContextTool,
  declareRelationshipTool,
  verifiedCircleTool,
  rememberPreferenceTool,
  recallMemoryTool,
} from "./social";
import { assessOrderRiskTool } from "./risk";

/**
 * Публикация через Светлану проходит ту же проверку, что и кнопки продавца:
 * без цены, фото и остатка карточка покупателям не попадает. Порядок прежний:
 * сначала верификация и владелец (их проверяет сам инструмент), потом карточка.
 */
const guardedPublishProductTool: ToolDefinition = {
  ...publishProductTool,
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const productId = typeof args.productId === "string" ? args.productId : "";
    if (productId && ctx.sellerProfileId) {
      const gate = await getSellerOnboardingGate(ctx.sellerProfileId);
      const owned = await prisma.product.findFirst({ where: { id: productId, sellerId: ctx.sellerProfileId }, select: { id: true } });
      if (gate.active && owned) {
        const problems = await publishProblems(prisma, productId);
        if (problems.length) return { ok: false, error: publishProblemsMessage(problems), verification: "NOT_PROVEN" };
      }
    }
    return publishProductTool.execute(ctx, args);
  },
};

/**
 * В кабинете продавца «заказы» означают заказы его покупателей, а не его
 * собственные покупки. Покупателю инструмент отвечает как раньше.
 */
const sellerAwareGetOrderTool: ToolDefinition = {
  ...getOrderTool,
  description: "Заказы: покупателю его покупки, продавцу заказы его покупателей. Реальные статусы, без выдумок.",
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const sellerId = ctx.sellerProfileId;
    const wantsSellerView = Boolean(sellerId) && ctx.role === "seller" && args.scope !== "buyer" && typeof args.orderId !== "string";
    if (!sellerId || !wantsSellerView) return getOrderTool.execute(ctx, args);
    const orders = await prisma.order.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        number: true,
        status: true,
        totalKopecks: true,
        items: { select: { titleSnapshot: true, quantity: true } },
      },
    });
    if (orders.length === 0) {
      return {
        ok: true,
        data: { items: [] },
        summary: "Заказов от покупателей пока нет. Как только кто-то купит ваш товар, заказ появится в разделе «Заказы» кабинета.",
        verification: "VERIFIED",
      };
    }
    const toShip = orders.filter((o) => ["PAID", "CONFIRMED", "PROCESSING", "READY"].includes(o.status)).length;
    return {
      ok: true,
      data: {
        items: orders.map((o) => ({
          orderId: o.id,
          number: o.number,
          status: o.status,
          title: `Заказ ${o.number}: ${o.items.map((i) => `${i.titleSnapshot} × ${i.quantity}`).join(", ")}`,
          priceKopecks: o.totalKopecks,
        })),
      },
      summary:
        `Последних заказов покупателей: ${orders.length}.` +
        (toShip > 0 ? ` Ждут вашей отправки: ${toShip}.` : " Отправки сейчас никто не ждёт.") +
        " Все заказы в разделе «Заказы» кабинета.",
      verification: "VERIFIED",
    };
  },
};

/** «Какую цену поставить?» без указания товара: берём самый просматриваемый товар продавца. */
const sellerAwareAdvisePriceTool: ToolDefinition = {
  ...advisePriceTool,
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.productId === "string" && args.productId) return advisePriceTool.execute(ctx, args);
    if (!ctx.sellerProfileId) return { ok: false, error: "совет по цене доступен в кабинете продавца", verification: "NOT_PROVEN" };
    const product = await prisma.product.findFirst({
      where: { sellerId: ctx.sellerProfileId, status: { in: ["ACTIVE", "DRAFT"] } },
      orderBy: [{ views: "desc" }, { updatedAt: "desc" }],
      select: { id: true, title: true },
    });
    if (!product) {
      return {
        ok: false,
        error: "у вас пока нет товаров. Добавьте товар (или напишите «создай карточку товара чайник за 1990»), и я посоветую цену",
        verification: "NOT_PROVEN",
      };
    }
    const result = await advisePriceTool.execute(ctx, { ...args, productId: product.id });
    return result.ok ? { ...result, summary: `Товар «${product.title}». ${result.summary ?? ""}`.trim() } : result;
  },
};

/** «Наушники дешевле 5000»: поиск по запросу от дешёвых к дорогим, а не случайные дешёвые товары. */
const queryAwareSearchCheaperTool: ToolDefinition = {
  ...searchCheaperTool,
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query || typeof args.productId === "string") return searchCheaperTool.execute(ctx, args);
    const maxPrice = Number(args.maxPrice);
    const { results } = await searchProducts(
      { query, maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined, sort: "price_asc", limit: 12 },
      ctx.traceId
    );
    return {
      ok: true,
      data: results.map((r) => ({
        productId: r.product.id,
        title: r.product.title,
        priceKopecks: r.product.priceKopecks,
        rating: r.product.rating,
        seller: r.product.sellerProfile.displayName,
      })),
      summary: results.length > 0
        ? `Нашла ${results.length} вариантов «${query}», от самого доступного:`
        : `Подешевле «${query}» ничего не нашлось. Попробуйте поднять бюджет или изменить запрос.`,
      verification: "VERIFIED",
    };
  },
};

const ALL_TOOLS: ToolDefinition[] = [
  // Catalog
  searchProductsTool,
  queryAwareSearchCheaperTool,
  compareProductsTool,
  getProductTool,
  visionSearchTool,
  getReviewsTool,
  searchSellersTool,
  searchClassifiedsTool,
  vinCheckTool,
  // Commerce
  sellerAwareGetOrderTool,
  cartAddTool,
  createOrderTool,
  cancelOrderTool,
  wishlistAddTool,
  requestReturnTool,
  createDisputeTool,
  getTrackingTool,
  getPaymentStatusTool,
  checkInventoryTool,
  // Seller
  analyzeSellerSalesTool,
  confirmInventoryTool,
  extendListingTool,
  createProductDraftTool,
  guardedPublishProductTool,
  changePriceTool,
  sellerAwareAdvisePriceTool,
  priceHistoryTool,
  findCompetitorsTool,
  scanGlobalCompetitorsTool,
  globalSearchTool,
  deliveryQuotesTool,
  productHealthTool,
  documentRequirementsTool,
  createWorkflowRuleTool,
  // Social / memory
  planGiftTool,
  upcomingEventsTool,
  giftContextTool,
  declareRelationshipTool,
  verifiedCircleTool,
  rememberPreferenceTool,
  recallMemoryTool,
  // Risk
  assessOrderRiskTool,
];

let bootstrapped = false;

export function registerAllTools(): void {
  if (bootstrapped) return;
  for (const tool of ALL_TOOLS) {
    toolRegistry.register(tool);
  }
  bootstrapped = true;
}

// Auto-register on first import so every consumer (API routes, agents, tests)
// sees a populated registry. registerAllTools is idempotent, so explicit
// callers are still safe.
registerAllTools();

export { toolRegistry };
