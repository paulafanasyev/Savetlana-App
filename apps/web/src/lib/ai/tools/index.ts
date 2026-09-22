/**
 * Tool registry bootstrap.
 *
 * Every tool the platform exposes is registered here exactly once. Agents ask
 * the registry (never the domain layer directly), so authorization,
 * confirmation gating and audit logging are uniformly enforced (spec §44).
 */
import { toolRegistry } from "./registry";
import type { ToolDefinition } from "./registry";

import {
  searchProductsTool,
  searchCheaperTool,
  compareProductsTool,
  getProductTool,
} from "./catalog";
import {
  getOrderTool,
  cartAddTool,
  createOrderTool,
  cancelOrderTool,
  wishlistAddTool,
  requestReturnTool,
  createDisputeTool,
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

const ALL_TOOLS: ToolDefinition[] = [
  // Catalog
  searchProductsTool,
  searchCheaperTool,
  compareProductsTool,
  getProductTool,
  // Commerce
  getOrderTool,
  cartAddTool,
  createOrderTool,
  cancelOrderTool,
  wishlistAddTool,
  requestReturnTool,
  createDisputeTool,
  // Seller
  analyzeSellerSalesTool,
  confirmInventoryTool,
  extendListingTool,
  createProductDraftTool,
  publishProductTool,
  changePriceTool,
  advisePriceTool,
  priceHistoryTool,
  findCompetitorsTool,
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
