import { describe, expect, it } from "vitest";
import { B2B_CATEGORIES, B2B_POLICIES, B2B_PRODUCTS, B2B_SELLERS } from "../src/lib/domains/demo-b2b";
import { isValidInn, isValidOgrn } from "../src/lib/legal";
import { normalizeNegotiationPolicy } from "../src/lib/domains/negotiation-policy";
import { rfqStems } from "../src/lib/ai/tools/negotiation-tool";

describe("Демо-продавцы B2B", () => {
  it("условные реквизиты проходят контрольную сумму и не задевают настоящие регионы", () => {
    for (const s of B2B_SELLERS) {
      expect(isValidInn(s.inn!)).toBe(true);
      expect(isValidOgrn(s.ogrn!)).toBe(true);
      expect(s.inn!.startsWith("00")).toBe(true);
      expect(s.name.startsWith("Демо")).toBe(true);
    }
  });

  it("у каждого продавца есть правила торга, один торг выключил", () => {
    const policies = B2B_SELLERS.map((s) => normalizeNegotiationPolicy(B2B_POLICIES[s.slug]));
    expect(policies.every((p) => p.custom)).toBe(true);
    expect(policies.filter((p) => !p.enabled)).toHaveLength(1);
    expect(policies.find((p) => p.enabled && p.volumeTiers.length >= 2)).toBeTruthy();
  });

  it("ассортимент пересекается: запрос цены находит минимум двух продавцов", () => {
    const sellers = new Set(B2B_SELLERS.map((s) => s.slug));
    const cats = new Set(B2B_CATEGORIES.map((c) => c.slug));
    for (const p of B2B_PRODUCTS) {
      expect(sellers.has(p.seller)).toBe(true);
      expect(cats.has(p.category)).toBe(true);
      expect(p.sku.startsWith("DEMO-")).toBe(true);
    }
    for (const q of ["перчатки рабочие", "каска защитная", "респиратор", "коробка картонная", "бумага а4"]) {
      const stems = rfqStems(q);
      const matched = new Set(
        B2B_PRODUCTS.filter((p) => stems.every((st) => `${p.title} ${JSON.stringify(p.keywords)}`.toLowerCase().replace(/ё/g, "е").includes(st))).map((p) => p.seller)
      );
      expect(matched.size, q).toBeGreaterThanOrEqual(2);
    }
  });
});
