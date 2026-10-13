/**
 * Tool registry bootstrap.
 *
 * Every tool the platform exposes is registered here exactly once. Agents ask
 * the registry (never the domain layer directly), so authorization,
 * confirmation gating and audit logging are uniformly enforced (spec §44).
 */
import { toolRegistry, looseObjectSchema } from "./registry";
import type { ToolDefinition, ToolContext, ToolResult } from "./registry";
import { prisma } from "../../prisma";
import { publishProblems, publishProblemsMessage } from "../../domains/publish-check";
import { getSellerOnboardingGate } from "../../domains/seller-onboarding";
import { searchProducts } from "../../domains/catalog";
import { sellerCustomerReport, SEGMENT_LABELS } from "../../domains/seller-crm";
import { startPromotionTool, endPromotionTool, sellerMessagesTool } from "./engagement";
import { promoState } from "../../domains/engagement-rules";
import { ruText } from "../ru-text";

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
 * Торговые действия через Светлану требуют той же проверки продавца, что и
 * кнопки кабинета: непроверенный продавец не может выставлять товар покупателям
 * или менять публичные цены.
 */
function verifiedOnly(tool: ToolDefinition, action: string): ToolDefinition {
  return {
    ...tool,
    async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
      if (!ctx.sellerProfileId) return { ok: false, error: "нужен кабинет продавца", verification: "NOT_PROVEN" };
      const gate = await getSellerOnboardingGate(ctx.sellerProfileId);
      if (!gate.active) {
        return { ok: false, error: `нельзя ${action}: ${gate.blockers.join(", ")}. Следующий шаг: ${gate.nextStep ?? "завершите проверку продавца"}`, verification: "NOT_PROVEN" };
      }
      return tool.execute(ctx, args);
    },
  };
}

/** Пока идёт акция, цену меняем только через её завершение, иначе потеряется настоящая прежняя цена. */
const promoAwareChangePriceTool: ToolDefinition = verifiedOnly(
  {
    ...changePriceTool,
    async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
      const productId = typeof args.productId === "string" ? args.productId : "";
      if (productId && ctx.sellerProfileId) {
        const product = await prisma.product.findFirst({ where: { id: productId, sellerId: ctx.sellerProfileId }, select: { priceKopecks: true, oldPriceKopecks: true } });
        if (product && promoState(product).onPromo) {
          return { ok: false, error: "на этот товар сейчас идёт скидка. Сначала верните обычную цену (раздел «Акции»), потом меняйте цену", verification: "NOT_PROVEN" };
        }
      }
      return changePriceTool.execute(ctx, args);
    },
  },
  "менять цены"
);

/**
 * Покупатель через Светлану отменяет только неоплаченный заказ, как и кнопкой
 * на сайте. Оплаченный заказ идёт через возврат или спор, иначе деньги
 * остались бы списанными, а заказ отменённым.
 */
const UNPAID = ["CREATED", "PAYMENT_PENDING"];
const unpaidOnlyCancelOrderTool: ToolDefinition = {
  ...cancelOrderTool,
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const orderId = typeof args.orderId === "string" ? args.orderId : "";
    if (orderId) {
      const order = await prisma.order.findFirst({ where: { id: orderId, buyerId: ctx.userId }, select: { status: true } });
      if (!order) return { ok: false, error: "заказ не найден", verification: "NOT_PROVEN" };
      if (!UNPAID.includes(order.status)) {
        return { ok: false, error: "оплаченный заказ нельзя просто отменить: оформите возврат или откройте спор на странице заказа, тогда деньги вернутся", verification: "NOT_PROVEN" };
      }
    }
    return cancelOrderTool.execute(ctx, args);
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

/** «Какую цену поставить?» без указания товара: берём самый просматриваемый активный товар продавца. */
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

/** CRM: покупатели магазина, сегменты и советы, по оплаченным заказам. */
const sellerCustomersTool: ToolDefinition = {
  name: "seller_customers",
  description: "CRM продавца: покупатели магазина, кто возвращается, VIP, новые и давно не покупавшие, средний чек и советы, как вернуть покупателей.",
  permission: "READ_ANALYTICS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({}),
  async execute(ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.sellerProfileId) return { ok: false, error: "раздел покупателей доступен в кабинете продавца", verification: "NOT_PROVEN" };
    const report = await sellerCustomerReport(ctx.sellerProfileId);
    const t = report.totals;
    if (t.customers === 0) {
      return { ok: true, data: { items: [] }, summary: report.advice.join(" "), verification: "VERIFIED" };
    }
    const segments = (Object.keys(report.segments) as (keyof typeof report.segments)[])
      .filter((k) => report.segments[k] > 0)
      .map((k) => `${SEGMENT_LABELS[k]}: ${report.segments[k]}`)
      .join(", ");
    return {
      ok: true,
      data: {
        totals: t,
        segments: report.segments,
        items: report.customers.slice(0, 5).map((c) => ({
          title: `${c.name}, ${SEGMENT_LABELS[c.segment].toLowerCase()}, заказов: ${c.ordersCount}`,
          priceKopecks: c.totalKopecks,
        })),
      },
      summary:
        `Покупателей: ${t.customers}, возвращаются ${t.repeatRatePercent}%. Средний чек ${Math.round(t.avgCheckKopecks / 100).toLocaleString("ru-RU")} ₽. ${segments}.` +
        (report.advice.length ? ` ${report.advice.join(" ")}` : "") +
        " Подробно в разделе «Покупатели». Лучшие по сумме покупок:",
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
  unpaidOnlyCancelOrderTool,
  wishlistAddTool,
  requestReturnTool,
  createDisputeTool,
  getTrackingTool,
  getPaymentStatusTool,
  checkInventoryTool,
  // Seller
  analyzeSellerSalesTool,
  sellerCustomersTool,
  sellerMessagesTool,
  startPromotionTool,
  endPromotionTool,
  verifiedOnly(confirmInventoryTool, "подтверждать наличие и выставлять товар"),
  extendListingTool,
  createProductDraftTool,
  guardedPublishProductTool,
  promoAwareChangePriceTool,
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

/** Ответы инструментов видит человек: служебные коды заменяем русскими словами. */
function localized(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
      const result = await tool.execute(ctx, args);
      return { ...result, summary: ruText(result.summary), error: ruText(result.error) };
    },
  };
}

let bootstrapped = false;

export function registerAllTools(): void {
  if (bootstrapped) return;
  for (const tool of ALL_TOOLS) {
    toolRegistry.register(localized(tool));
  }
  bootstrapped = true;
}

// Auto-register on first import so every consumer (API routes, agents, tests)
// sees a populated registry. registerAllTools is idempotent, so explicit
// callers are still safe.
registerAllTools();

export { toolRegistry };
export { confirmPreview } from "./engagement";
