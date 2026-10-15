import { describe, expect, it } from "vitest";
import { composeMany, sanitizeComposition, splitProductLines, titleKey } from "../src/lib/domains/product-compose-bulk";

describe("много карточек из списка", () => {
  it("делит список на строки без нумерации и мусора", () => {
    expect(splitProductLines("1. Кружка белая, 450 ₽\n\n- Ложка стальная 120 р\n• Нож\n  Чайник Bosch 1,7 л  ")).toEqual([
      "Кружка белая, 450 ₽",
      "Ложка стальная 120 р",
      "Чайник Bosch 1,7 л",
    ]);
  });

  it("каждая строка разбирается правилами", () => {
    const items = composeMany("Кружка керамическая 350 мл, белая, 450 ₽\nСмартфон Samsung 128 гб, черный, б/у, 15 000 ₽", [{ slug: "phones", name: "Смартфоны" }]);
    expect(items).toHaveLength(2);
    expect(items[0].priceRub).toBe(450);
    expect(items[0].attributes).toMatchObject({ "Объём": "350 мл", "Цвет": "белый", "Материал": "керамика" });
    expect(items[1].categorySlug).toBe("phones");
    expect(items[1].priceRub).toBe(15000);
  });

  it("карточка из браузера проверяется заново", () => {
    const slugs = new Set(["phones"]);
    expect(sanitizeComposition({ title: "??" }, slugs)).toBeNull();
    const c = sanitizeComposition({ title: " Кружка ", priceRub: -5, categorySlug: "hack", attributes: { "Цвет": "белый", "": "x" }, keywords: ["кружка", 5] }, slugs);
    expect(c).toEqual({ title: "Кружка", description: "Кружка", priceRub: undefined, categorySlug: "", keywords: ["кружка"], attributes: { "Цвет": "белый" } });
    expect(titleKey("  Кружка   Белая ")).toBe(titleKey("кружка белая"));
  });
});
