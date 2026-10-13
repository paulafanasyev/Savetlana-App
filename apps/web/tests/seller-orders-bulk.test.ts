import { describe, expect, it } from "vitest";
import { actionReason, allowedSellerActions, isSellerOrderAction } from "../src/lib/domains/order-rules";
import { parseCsv, planBulk, toCsv } from "../src/lib/domains/bulk-rules";

describe("действия продавца с заказом", () => {
  it("показывает только допустимые кнопки", () => {
    expect(allowedSellerActions("PAID")).toEqual(["reject"]);
    expect(allowedSellerActions("RETURN_REQUESTED")).toEqual(["accept_return", "decline_return"]);
    expect(allowedSellerActions("RETURNING")).toEqual(["refund_return"]);
    expect(allowedSellerActions("CONFIRMED")).toEqual([]);
    expect(allowedSellerActions("REFUNDED")).toEqual([]);
    expect(isSellerOrderAction("reject")).toBe(true);
    expect(isSellerOrderAction("delete")).toBe(false);
  });

  it("требует причину отказа", () => {
    expect(actionReason("reject", "", "").ok).toBe(false);
    expect(actionReason("reject", "OTHER", "коротко").ok).toBe(false);
    const ok = actionReason("reject", "OUT_OF_STOCK", "");
    expect(ok.ok && ok.text).toBe("Товар закончился");
    expect(actionReason("decline_return", undefined, "нет").ok).toBe(false);
    expect(actionReason("decline_return", undefined, "Товар был в употреблении").ok).toBe(true);
    expect(actionReason("accept_return", undefined, undefined).ok).toBe(true);
  });
});

describe("массовое изменение цен и остатков", () => {
  const current = [
    { id: "a", sku: "A1", title: "Чайник", status: "ACTIVE", priceKopecks: 100_000, oldPriceKopecks: null, quantity: 5 },
    { id: "b", sku: "B1", title: "Кружка", status: "ACTIVE", priceKopecks: 50_000, oldPriceKopecks: 70_000, quantity: 3 },
    { id: "c", sku: "C1", title: "Ложка", status: "DRAFT", priceKopecks: 10_000, oldPriceKopecks: null, quantity: 0 },
  ];

  it("не трогает цену во время скидки, но меняет остаток", () => {
    const plan = planBulk(current, [{ id: "b", priceRub: 600, stockQuantity: 10 }], { verified: true });
    expect(plan.changes).toEqual([{ id: "b", title: "Кружка", stockFrom: 3, stockTo: 10 }]);
    expect(plan.skipped[0].reason).toMatch(/скидка/);
  });

  it("цены опубликованных товаров меняет только проверенный продавец", () => {
    const plan = planBulk(current, [{ id: "a", priceRub: 900 }, { id: "c", priceRub: 120 }], { verified: false });
    expect(plan.changes.map((c) => c.id)).toEqual(["c"]);
    expect(plan.skipped[0].reason).toMatch(/проверки/);
    const verified = planBulk(current, [{ id: "a", priceRub: 900 }], { verified: true });
    expect(verified.changes[0]).toMatchObject({ priceFrom: 100_000, priceTo: 90_000 });
  });

  it("отсеивает чужие товары и неверные значения", () => {
    const plan = planBulk(current, [{ id: "zzz", priceRub: 1 }, { id: "a", priceRub: 0.5 }, { id: "c", stockQuantity: -1 }, { id: "a", stockQuantity: 5 }], { verified: true });
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toHaveLength(3);
  });

  it("CSV выгружается и загружается обратно", () => {
    const csv = toCsv([{ sku: "A1", title: "Чайник; стальной", priceKopecks: 129_900, quantity: 4 }]);
    expect(csv.split("\n")[0]).toBe("Код;Название;Цена;Остаток");
    const parsed = parseCsv("\uFEFF" + csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{ sku: "A1", priceRub: 1299, stockQuantity: 4 }]);
  });

  it("пустая ячейка значит «не менять», текст вместо числа даёт ошибку", () => {
    const parsed = parseCsv("Код;Название;Цена;Остаток\nA1;Чайник;;7\nB1;Кружка;дорого;1\nC1;Ложка;99,5;");
    expect(parsed.rows).toEqual([
      { sku: "A1", priceRub: undefined, stockQuantity: 7 },
      { sku: "C1", priceRub: 99.5, stockQuantity: undefined },
    ]);
    expect(parsed.errors).toHaveLength(1);
  });
});
