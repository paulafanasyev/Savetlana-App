import { describe, expect, it } from "vitest";
import { combineStocks, fetchStocks, MARKET_API, withStocks } from "../src/lib/domains/yandex-market";

const KEY = "test-key-not-real-00000";

describe("остатки с Маркета", () => {
  it("берём «доступно к заказу», иначе «годный», и наибольшее по складу, а не сумму", () => {
    const m = combineStocks([
      { result: { warehouses: [{ offers: [{ offerId: "A", stocks: [{ type: "FIT", count: 9 }, { type: "AVAILABLE", count: 7 }] }, { offerId: "B", stocks: [{ type: "FIT", count: 3 }] }] }] } },
      { result: { warehouses: [{ offers: [{ offerId: "A", stocks: [{ type: "AVAILABLE", count: 7 }] }, { offerId: "C", stocks: [{ type: "DEFECT", count: 5 }] }] }] } },
    ]);
    expect(m.get("A")).toBe(7);
    expect(m.get("B")).toBe(3);
    expect(m.has("C")).toBe(false);
  });

  it("неизвестный остаток не трогаем", () => {
    const items = [
      { article: "A", title: "А", description: "", priceRub: 1, images: [] },
      { article: "Z", title: "Я", description: "", priceRub: 1, images: [], quantity: 2 },
    ];
    const out = withStocks(items, new Map([["A", 4]]));
    expect(out[0].quantity).toBe(4);
    expect(out[1].quantity).toBe(2);
    expect(withStocks(items, null)).toBe(items);
  });

  it("склад Маркета (FBY) не считаем, ошибка магазина не ломает перенос", async () => {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      let body: unknown = {};
      let status = 200;
      if (url.includes("/v2/campaigns?")) {
        body = { campaigns: [
          { id: 11, placementType: "FBY", business: { id: 7 } },
          { id: 12, placementType: "FBS", business: { id: 7 } },
          { id: 13, placementType: "DBS", business: { id: 7 } },
          { id: 14, placementType: "FBS", business: { id: 8 } },
        ] };
      } else if (url.includes("/v2/campaigns/12/")) {
        body = { result: { warehouses: [{ offers: [{ offerId: "A", stocks: [{ type: "AVAILABLE", count: 5 }] }] }] } };
      } else status = 500;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const m = await fetchStocks(KEY, 7, ["A", "A", " "], { fetchImpl: impl });
    expect(m?.get("A")).toBe(5);
    expect(calls.some((u) => u.includes("/v2/campaigns/11/"))).toBe(false);
    expect(calls.some((u) => u.includes("/v2/campaigns/14/"))).toBe(false);
    expect(calls.every((u) => u.startsWith(`${MARKET_API}/`) && !u.includes(KEY))).toBe(true);
  });

  it("если ни один магазин не отдал остатки, null", async () => {
    const impl = (async (url: string) =>
      new Response(JSON.stringify(url.includes("/v2/campaigns?") ? { campaigns: [{ id: 12, placementType: "FBS", business: { id: 7 } }] } : {}), {
        status: url.includes("/v2/campaigns?") ? 200 : 403,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    expect(await fetchStocks(KEY, 7, ["A"], { fetchImpl: impl })).toBeNull();
  });
});
