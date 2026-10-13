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

const ALL_TOOLS: ToolDefinition[] = [
  // Catalog
  searchProductsTool,
  searchCheaperTool,
  compareProductsTool,
  getProductTool,
  visionSearchTool,
  getReviewsTool,
  searchSellersTool,
  searchClassifiedsTool,
  vinCheckTool,
  // Commerce
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
  // Seller
  analyzeSellerSalesTool,
  confirmInventoryTool,
  extendListingTool,
  createProductDraftTool,
  guardedPublishProductTool,
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
