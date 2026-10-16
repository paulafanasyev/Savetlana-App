import { describe, expect, it } from "vitest";
import { queryNumber } from "../src/lib/query-number";

describe("число из параметра ссылки", () => {
  it("нет параметра или пусто: фильтра нет", () => {
    expect(queryNumber(null)).toBe(undefined);
    expect(queryNumber(undefined)).toBe(undefined);
    expect(queryNumber("")).toBe(undefined);
    expect(queryNumber("  ")).toBe(undefined);
  });
  it("числа и мусор", () => {
    expect(queryNumber("0")).toBe(0);
    expect(queryNumber("1500")).toBe(1500);
    expect(queryNumber("-5")).toBe(undefined);
    expect(queryNumber("abc")).toBe(undefined);
  });
});
