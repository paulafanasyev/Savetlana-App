import { describe, it, expect } from "vitest";
import { computeAvailability, LISTING_DEFAULT_DAYS } from "../src/lib/domains/inventory";

describe("availability computation (spec §10)", () => {
  it("reports in-stock confirmed items as available", () => {
    expect(computeAvailability(10, true, new Date(Date.now() + 864e5))).toBe("AVAILABLE");
  });

  it("degrades low stock to limited", () => {
    expect(computeAvailability(2, true, new Date(Date.now() + 864e5))).toBe("LIMITED");
  });

  it("reports zero stock as out of stock", () => {
    expect(computeAvailability(0, true, new Date(Date.now() + 864e5))).toBe("OUT_OF_STOCK");
  });

  it("never reports availability without seller confirmation", () => {
    const future = new Date(Date.now() + 864e5);
    expect(computeAvailability(10, false, future)).toBe("UNKNOWN");
    expect(computeAvailability(0, false, future)).toBe("OUT_OF_STOCK");
  });

  it("expires unconfirmed listings", () => {
    const past = new Date(Date.now() - 864e5);
    expect(computeAvailability(10, true, past)).toBe("UNKNOWN");
  });

  it("uses a configurable default listing window", () => {
    expect(LISTING_DEFAULT_DAYS).toBeGreaterThanOrEqual(7);
  });
});
