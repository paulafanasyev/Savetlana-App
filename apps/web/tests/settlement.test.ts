import { describe, it, expect } from "vitest";
import { computeSettlement, PLATFORM_FEE_PERCENT } from "../src/lib/domains/payments";

describe("settlement math", () => {
  it("uses the configurable platform fee of 1.5%", () => {
    expect(PLATFORM_FEE_PERCENT).toBe(1.5);
  });

  it("splits an order into the seller payout components", () => {
    const s = computeSettlement({
      grossKopecks: 100000,
      paymentFeeKopecks: 2000,
      deliveryKopecks: 5000,
      adjustmentsKopecks: 0,
    });
    expect(s.platformFeeKopecks).toBe(1500);
    expect(s.payoutKopecks).toBe(100000 - 1500 - 2000 - 5000);
    expect(s.payoutKopecks).toBe(91500);
  });

  it("subtracts adjustments from the payout", () => {
    const s = computeSettlement({
      grossKopecks: 50000,
      paymentFeeKopecks: 1000,
      deliveryKopecks: 0,
      adjustmentsKopecks: 3000,
    });
    expect(s.payoutKopecks).toBe(50000 - 750 - 1000 - 3000);
  });

  it("never produces a negative payout from fees alone", () => {
    const s = computeSettlement({
      grossKopecks: 100,
      paymentFeeKopecks: 0,
      deliveryKopecks: 0,
      adjustmentsKopecks: 0,
    });
    expect(s.payoutKopecks).toBeGreaterThanOrEqual(0);
  });
});
