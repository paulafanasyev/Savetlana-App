import { describe, expect, it } from "vitest";
import { chatDraftArgs, chatDraftReport, chatDraftSource } from "../src/lib/domains/chat-product-draft";

const categories = [
  { slug: "shoes", name: "Кроссовки и кеды" },
  { slug: "phones", name: "Смартфоны" },
];

describe("карточка из чата со Светланой", () => {
  it("отделяет просьбу от описания товара", () => {
    expect(chatDraftSource("Светлана, создай карточку: кроссовки Nike, 7990 ₽")).toEqual({ text: "кроссовки Nike, 7990 ₽", command: true });
    expect(chatDraftSource("Оформи карточку товара чайник Bosch за 2990")).toEqual({ text: "чайник Bosch за 2990", command: true });
    expect(chatDraftSource("создай карточку")).toBeNull();
    expect(chatDraftSource("да, давай")).toEqual({ text: "да, давай", command: false });
    expect(chatDraftSource("Вот кроссовки Nike, 42 размер, 7990 ₽, оформи карточку")).toEqual({ text: "кроссовки Nike, 42 размер, 7990 ₽", command: true });
  });

  it("заполняет цену, категорию и характеристики из сообщения", () => {
    const source = chatDraftSource("Создай карточку: кроссовки Nike Air Max 90, белые, 42 размер, новые, 7990 ₽")!;
    // Так аргументы собирает встроенный разбор: всё подряд в названии, без цены.
    const args = chatDraftArgs({ title: "Кроссовки Nike Air Max 90 белые 42 размер новые 7990 ₽" }, source, categories)!;
    expect(args.title).toBe("Кроссовки Nike Air Max 90, белые, 42 размер, новые");
    expect(args.priceRub).toBe(7990);
    expect(args.categorySlug).toBe("shoes");
    expect(args.attributes).toMatchObject({ "Бренд": "Nike", "Размер": "42", "Цвет": "белый", "Состояние": "новый" });
    expect(args.keywords).toContain("nike");
  });

  it("не берёт у модели того, чего нет в тексте", () => {
    const source = chatDraftSource("создай карточку: смартфон Samsung 128 гб, черный")!;
    const args = chatDraftArgs(
      {
        title: "Смартфон Samsung Galaxy S24",
        priceRub: 59990,
        categorySlug: "hack",
        description: "Флагман 2024 года с гарантией 12 месяцев и быстрой зарядкой.",
        attributes: { "Память": "128 ГБ", "Гарантия": "12 месяцев" },
      },
      source,
      categories,
    )!;
    expect(args.priceRub).toBeUndefined();
    expect(args.categorySlug).toBe("phones");
    expect(args.title).toBe("Смартфон Samsung 128 гб, черный");
    expect(args.description).not.toContain("гарантией");
    expect(args.attributes).toMatchObject({ "Память": "128 ГБ" });
    expect((args.attributes as Record<string, string>)["Гарантия"]).toBeUndefined();
  });

  it("без описания товара аргументы модели не трогает", () => {
    expect(chatDraftArgs({ title: "Чайник" }, chatDraftSource("да, давай")!, categories)).toBeNull();
  });

  it("честно говорит, чего не хватает", () => {
    const text = chatDraftReport({ title: "Чайник", attributes: {} }, null);
    expect(text).toContain("Черновик «Чайник» создан");
    expect(text).toContain("Добавьте цену, категорию, фото и остаток");
    const full = chatDraftReport({ title: "Кроссовки", priceRub: 7990, attributes: { "Размер": "42" }, description: "x" }, "Кроссовки и кеды");
    expect(full).toContain("цена 7");
    expect(full).toContain("категория «Кроссовки и кеды»");
    expect(full).toContain("размер: 42");
    expect(full).toContain("Добавьте фото и остаток");
  });
});
