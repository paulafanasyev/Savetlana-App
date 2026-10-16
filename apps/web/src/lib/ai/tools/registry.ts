/**
 * Tool Registry (spec §44, §39, §45, §147).
 *
 * Every capability an agent can exercise is declared here with:
 *   - an explicit permission (never implicit, never "all of the DB")
 *   - a risk level, which decides whether human confirmation is required
 *   - a JSON schema the model must satisfy
 *   - an executor that talks to the real domain layer
 *
 * Agents cannot reach around this registry: it is the only path from an AI
 * decision to a state change.
 */
import type { VerificationVerdict } from "../../utils";

export type ToolPermission =
  | "READ_PRODUCTS"
  | "READ_REVIEWS"
  | "READ_SELLERS"
  | "READ_ORDERS"
  | "READ_TRACKING"
  | "READ_PROFILE"
  | "READ_ANALYTICS"
  | "READ_RISK"
  | "CART_WRITE"
  | "WISHLIST_WRITE"
  | "CREATE_ORDER"
  | "CANCEL_ORDER"
  | "REQUEST_RETURN"
  | "CREATE_DISPUTE"
  | "CONFIRM_RECEIPT"
  | "CREATE_PRODUCT_DRAFT"
  | "EDIT_PRODUCT_DRAFT"
  | "PUBLISH_PRODUCT"
  | "CHANGE_PRICE"
  | "CONFIRM_INVENTORY"
  | "EXTEND_LISTING"
  | "WRITE_MEMORY"
  | "READ_MEMORY"
  | "REQUEST_PAYOUT"
  | "CREATE_SHIPMENT"
  | "GIFT_WRITE"
  | "RELATIONSHIP_WRITE";

export type RiskLevel =
  | "READ"
  | "LOW_RISK_WRITE"
  | "HIGH_RISK_WRITE"
  | "FINANCIAL"
  | "ACCOUNT_SECURITY";

export interface ToolContext {
  userId: string;
  /** buyer | seller | specialist | admin | guest */
  role: string;
  /** Present when the user acting is a seller (own profile). */
  sellerProfileId?: string;
  traceId: string;
  /**
   * Confirmation gate. Sensitive tools call this before mutating anything
   * (spec §45, §147). In the UI this surfaces a real confirm dialog; in tests
   * it can be auto-accepted/denied.
   */
  confirm?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  /** Human-readable summary the agent can relay to the user. */
  summary?: string;
  error?: string;
  /** How the outcome itself was verified. */
  verification: VerificationVerdict;
}

export interface ToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  riskLevel: RiskLevel;
  parameters: Record<string, unknown>;
  /** True when a human must explicitly approve before execution. */
  needsConfirmation: boolean;
  execute: (
    ctx: ToolContext,
    args: Record<string, unknown>
  ) => Promise<ToolResult>;
}

/**
 * Role → permission set. This is the authorization boundary for AI actions:
 * a buyer-side agent can never publish a product, no matter how it is asked.
 * A guest (not signed in) may only read the public catalog.
 */
const ROLE_PERMISSIONS: Record<string, ToolPermission[]> = {
  guest: ["READ_PRODUCTS", "READ_REVIEWS", "READ_SELLERS"],
  buyer: [
    "READ_PRODUCTS",
    "READ_REVIEWS",
    "READ_SELLERS",
    "READ_ORDERS",
    "READ_TRACKING",
    "READ_PROFILE",
    "CART_WRITE",
    "WISHLIST_WRITE",
    "CREATE_ORDER",
    "CANCEL_ORDER",
    "REQUEST_RETURN",
    "CREATE_DISPUTE",
    "CONFIRM_RECEIPT",
    "READ_MEMORY",
    "WRITE_MEMORY",
    "GIFT_WRITE",
    "RELATIONSHIP_WRITE",
  ],
  seller: [
    "READ_PRODUCTS",
    "READ_REVIEWS",
    "READ_SELLERS",
    "READ_ORDERS",
    "READ_TRACKING",
    "READ_ANALYTICS",
    "CREATE_PRODUCT_DRAFT",
    "EDIT_PRODUCT_DRAFT",
    "PUBLISH_PRODUCT",
    "CHANGE_PRICE",
    "CONFIRM_INVENTORY",
    "EXTEND_LISTING",
    "REQUEST_PAYOUT",
    "CREATE_SHIPMENT",
    "READ_MEMORY",
    "WRITE_MEMORY",
  ],
  specialist: ["READ_PRODUCTS", "READ_SELLERS", "READ_MEMORY", "WRITE_MEMORY"],
  admin: [
    "READ_PRODUCTS",
    "READ_REVIEWS",
    "READ_SELLERS",
    "READ_ORDERS",
    "READ_TRACKING",
    "READ_ANALYTICS",
    "READ_PROFILE",
    "READ_RISK",
  ],
};

export function permissionsForRole(role: string): ToolPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Tools an actor of `role` is allowed to see/call at all. */
  listAuthorized(role: string): ToolDefinition[] {
    const allowed = new Set(permissionsForRole(role));
    return this.list().filter((t) => allowed.has(t.permission));
  }

  /**
   * Authorization + confirmation gate. Returns a denial the agent must relay
   * honestly — never a silent success (spec §39, §58).
   */
  async authorize(
    name: string,
    ctx: ToolContext,
    args: Record<string, unknown>
  ): Promise<
    | { allowed: true; tool: ToolDefinition }
    | { allowed: false; reason: string }
  > {
    const tool = this.get(name);
    if (!tool) {
      return { allowed: false, reason: `инструмент не существует: ${name}` };
    }
    if (!permissionsForRole(ctx.role).includes(tool.permission)) {
      return {
        allowed: false,
        reason: `у вашей роли нет разрешения ${tool.permission} для инструмента ${name}`,
      };
    }
    if (tool.needsConfirmation) {
      const confirmed = ctx.confirm
        ? await ctx.confirm(name, args)
        : false;
      if (!confirmed) {
        return {
          allowed: false,
          reason: `требуется подтверждение пользователя для действия ${name}`,
        };
      }
    }
    return { allowed: true, tool };
  }
}

export const toolRegistry = new ToolRegistry();

/** Helper: a schema for an object with optional string props. */
export function looseObjectSchema(
  props: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: "object",
    properties: props,
    additionalProperties: true,
  };
}
