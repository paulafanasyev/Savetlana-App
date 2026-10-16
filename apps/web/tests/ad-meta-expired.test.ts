import { describe, expect, it } from "vitest";
import { adMeta } from "../src/lib/ad-meta";

describe("истёкшее объявление", () => {
  const base = { title: "Диван угловой", price: null, cityName: "Казань", description: null, demo: false };
  it("действующее индексируется, истёкшее нет", () => {
    expect(adMeta(base).index).toBe(true);
    expect(adMeta({ ...base, expired: false }).index).toBe(true);
    expect(adMeta({ ...base, expired: true }).index).toBe(false);
  });
});
