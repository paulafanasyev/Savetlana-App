import { describe, expect, it } from "vitest";
import { inventedNumbers, matchCategory, mergeModelComposition, parseProductText, titleFromText, valueInText } from "../src/lib/domains/product-compose";

const cats = [
  { slug: "shoes", name: "Обувь и кроссовки" },
  { slug: "phones", name: "Смартфоны" },
];

describe("Светлана составляет карточку товара", () => {
  it("раскладывает текст продавца по полям и ничего не добавляет", () => {
    const d = parseProductText("Кроссовки Nike Air Max 90, белые, 42 размер, новые, 7990 ₽", cats);
    expect(d.title).toBe("Кроссовки Nike Air Max 90, белые, 42 размер, новые");
    expect(d.priceRub).toBe(7990);
    expect(d.categorySlug).toBe("shoes");
    expect(d.attributes).toEqual({ "Бренд": "Nike", "Размер": "42", "Цвет": "белый", "Состояние": "новый" });
    expect(d.keywords).toContain("кроссовки");
    expect(d.description).toContain("Цвет: белый");
  });

  it("память, б/у и цена с пробелом", () => {
    const d = parseProductText("Продаю смартфон Samsung Galaxy S21 128 гб, черный, б/у, цена 25 000", cats);
    expect(d.title.startsWith("Смартфон Samsung")).toBe(true);
    expect(d.priceRub).toBe(25000);
    expect(d.categorySlug).toBe("phones");
    expect(d.attributes).toMatchObject({ "Память": "128 ГБ", "Состояние": "б/у", "Цвет": "чёрный" });
  });

  it("без цены в тексте цену не ставит, год не путает с весом", () => {
    const d = parseProductText("Чайник Bosch, 2021 г., 1,7 л, будет как новый", cats);
    expect(d.priceRub).toBeUndefined();
    expect(d.attributes["Вес"]).toBeUndefined();
    expect(d.attributes["Объём"]).toBe("1,7 л");
    expect(d.categorySlug).toBe("");
    expect(matchCategory("что-то совсем другое", cats)).toBe("");
  });

  it("ответ модели проверяется: выдумки отбрасываются", () => {
    const text = "Кроссовки Nike Air Max 90, белые, 42 размер, новые, 7990 ₽";
    const base = parseProductText(text, cats);
    const merged = mergeModelComposition(
      base,
      {
        title: "Кроссовки Nike Air Max 90 белые",
        description: "Белые кроссовки Nike Air Max 90. Гарантия 12 месяцев.",
        priceRub: 5990,
        categorySlug: "unknown",
        keywords: ["кроссовки", "nike"],
        attributes: { "Цвет": "белый", "Страна": "Вьетнам" },
      },
      text,
      cats,
    );
    expect(merged.title).toBe("Кроссовки Nike Air Max 90 белые");
    expect(merged.description).toBe(base.description);
    expect(merged.priceRub).toBe(7990);
    expect(merged.categorySlug).toBe("shoes");
    expect(merged.attributes["Страна"]).toBeUndefined();
    expect(inventedNumbers("Цена 7990", "за 7 990 ₽")).toEqual([]);
    expect(valueInText("белый", "белые кроссовки")).toBe(true);
    expect(titleFromText("Кроссовки Nike Air Max 90 Essential", text)).toBe(false);
  });
});
