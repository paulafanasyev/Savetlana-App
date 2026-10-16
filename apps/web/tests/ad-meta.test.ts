import { describe, expect, it } from "vitest";
import { adMeta } from "../src/lib/ad-meta";

describe("заголовок страницы объявления", () => {
  it("название, цена и город", () => {
    const m = adMeta({ title: "Kia Rio, 2020", price: "1 390 000 ₽", cityName: "Москва", description: "Один владелец.", demo: false });
    expect(m.title).toBe("Kia Rio, 2020 · 1 390 000 ₽ · Москва | АИКО");
    expect(m.description).toBe("Один владелец.");
    expect(m.index).toBe(true);
  });
  it("без цены и описания, длинный текст обрезается", () => {
    const m = adMeta({ title: "Ремонт квартир", price: null, cityName: "Казань", description: null, demo: false });
    expect(m.title).toBe("Ремонт квартир · Казань | АИКО");
    expect(m.description).toBe("Ремонт квартир в городе Казань на АИКО");
    const long = adMeta({ title: "x", price: null, cityName: "Москва", description: "а".repeat(500), demo: false });
    expect(long.description.length).toBe(160);
  });
  it("пример не индексируется", () => {
    expect(adMeta({ title: "Пример: дом", price: null, cityName: "Москва", description: null, demo: true }).index).toBe(false);
  });
});
