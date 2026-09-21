import { describe, it, expect } from "vitest";
import { toolRegistry } from "../src/lib/ai/tools/registry";
import { registerAllTools } from "../src/lib/ai/tools";
import { permissionsForRole } from "../src/lib/ai/tools/registry";

registerAllTools();

describe("tool registry authorization", () => {
  it("registers the tool catalogue", () => {
    expect(toolRegistry.list().length).toBeGreaterThan(15);
    expect(toolRegistry.get("search_products")).toBeDefined();
    expect(toolRegistry.get("confirm_inventory")).toBeDefined();
  });

  it("gives buyers no seller permissions", () => {
    const perms = new Set(permissionsForRole("buyer"));
    expect(perms.has("READ_PRODUCTS")).toBe(true);
    expect(perms.has("PUBLISH_PRODUCT")).toBe(false);
    expect(perms.has("CHANGE_PRICE")).toBe(false);
    expect(perms.has("CONFIRM_INVENTORY")).toBe(false);
  });

  it("gives sellers no order-creation permission", () => {
    const perms = new Set(permissionsForRole("seller"));
    expect(perms.has("CREATE_ORDER")).toBe(false);
    expect(perms.has("CANCEL_ORDER")).toBe(false);
    expect(perms.has("CONFIRM_INVENTORY")).toBe(true);
  });

  it("denies buyers access to seller tools", async () => {
    const verdict = await toolRegistry.authorize(
      "confirm_inventory",
      { userId: "u1", role: "buyer", traceId: "t1" },
      {}
    );
    expect(verdict.allowed).toBe(false);
  });

  it("demands confirmation for sensitive tools", async () => {
    const verdict = await toolRegistry.authorize(
      "confirm_inventory",
      { userId: "u1", role: "seller", sellerProfileId: "s1", traceId: "t1" },
      {}
    );
    if (verdict.allowed) throw new Error("should be denied");
    expect(verdict.reason).toContain("подтверждение");
  });

  it("refuses unknown tools", async () => {
    const verdict = await toolRegistry.authorize(
      "drop_database",
      { userId: "u1", role: "admin", traceId: "t1" },
      {}
    );
    expect(verdict.allowed).toBe(false);
  });

  it("marks financial tools as requiring confirmation", () => {
    const create = toolRegistry.get("create_order");
    expect(create?.riskLevel).toBe("FINANCIAL");
    expect(create?.needsConfirmation).toBe(true);
  });

  it("keeps read-only tools confirmation-free", () => {
    const search = toolRegistry.get("search_products");
    expect(search?.riskLevel).toBe("READ");
    expect(search?.needsConfirmation).toBe(false);
  });
});
