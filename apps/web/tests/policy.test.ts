import { describe, it, expect } from "vitest";
import { decide, assertKnown, PolicyAssertionError, AGENT_LIMITS } from "../src/lib/ai/agents/policy";

describe("agent policy", () => {
  it("allows reads unconditionally", () => {
    expect(decide("READ", false).decision).toBe("proceed");
  });

  it("requires confirmation for financial writes", () => {
    expect(decide("FINANCIAL", false).decision).toBe("needs_user_confirmation");
    expect(decide("FINANCIAL", true).decision).toBe("proceed");
  });

  it("requires confirmation for account security actions", () => {
    expect(decide("ACCOUNT_SECURITY", false).decision).toBe("needs_user_confirmation");
  });

  it("allows low-risk writes on their own", () => {
    expect(decide("LOW_RISK_WRITE", false).decision).toBe("proceed");
  });

  it("never self-confirms high-risk writes", () => {
    expect(decide("HIGH_RISK_WRITE", false).decision).toBe("needs_user_confirmation");
  });

  it("asserts known values instead of inventing them", () => {
    expect(assertKnown("hello", "field")).toBe("hello");
    expect(() => assertKnown(null, "price")).toThrow(PolicyAssertionError);
    expect(() => assertKnown("", "name")).toThrow(/NOT_AVAILABLE/);
  });

  it("bounds the agent loop", () => {
    expect(AGENT_LIMITS.maxSteps).toBeLessThanOrEqual(12);
    expect(AGENT_LIMITS.maxToolCalls).toBeLessThanOrEqual(10);
    expect(AGENT_LIMITS.maxRetriesPerTool).toBeGreaterThanOrEqual(1);
  });
});
