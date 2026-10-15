import { describe, expect, it } from "vitest";
import { planStockSync, sellerArticle } from "../src/lib/domains/market-stock-sync";

describe("обновление остатков с Маркета", () => {
  it("артикул берётся из характеристик переноса", () => {
    expect(sellerArticle(JSON.stringify({ "Артикул продавца": " A-1 ", "Бренд": "X" }))).toBe("A-1");
    expect(sellerArticle(JSON.stringify({ "Бренд": "X" }))).toBe("");
    expect(sellerArticle("не json")).toBe("");
    expect(sellerArticle(null)).toBe("");
  });

  it("меняется только то, что отличается, неизвестное не трогаем", () => {
    const stocks = new Map([["A-1", 5], ["A-2", 3], ["A-4", 0]]);
    const plan = planStockSync(
      [
        { id: "p1", title: "Кружка", article: "A-1", quantity: 2 },
        { id: "p2", title: "Ложка", article: "A-2", quantity: 3 },
        { id: "p3", title: "Вилка", article: "A-3", quantity: 7 },
        { id: "p4", title: "Нож", article: "A-4", quantity: 4 },
      ],
      stocks,
    );
    expect(plan.items).toEqual([{ id: "p1", stockQuantity: 5 }, { id: "p4", stockQuantity: 0 }]);
    expect(plan.changes).toEqual([{ title: "Кружка", from: 2, to: 5 }, { title: "Нож", from: 4, to: 0 }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.notOnMarket).toBe(1);
  });
});
