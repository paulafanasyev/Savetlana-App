import { describe, it, expect } from "vitest";
import { toKopecks, fromKopecks, formatMoney, generateOrderNumber, slugify, maskString } from "../src/lib/utils";

describe("money helpers", () => {
  it("converts rubles to kopecks without float drift", () => {
    expect(toKopecks(100)).toBe(10000);
    expect(toKopecks(99.99)).toBe(9999);
    expect(toKopecks(0)).toBe(0);
  });

  it("converts back", () => {
    expect(fromKopecks(10000)).toBeCloseTo(100, 10);
  });

  it("formats for display", () => {
    expect(formatMoney(10000)).toContain("100");
  });

  it("generates unique order numbers", () => {
    const a = generateOrderNumber();
    const b = generateOrderNumber();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(6);
  });

  it("slugifies titles", () => {
    expect(slugify("Ноутбук Aurora 14")).toContain("noutbuk");
  });

  it("masks sensitive identifiers", () => {
    expect(maskString("40817810099910004312")).toContain("*");
  });
});
