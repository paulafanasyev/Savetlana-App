import { describe, expect, it } from "vitest";
import { chooseShown, detectReference, extractShownItems, planReferenceAction, resolveToolArgs } from "../src/lib/ai/references";
import { ruText } from "../src/lib/ai/ru-text";
import { stockAlertText, stockAlertUrl, stockLevel } from "../src/lib/domains/stock-rules";

const shown = [
  { productId: "p1", title: "Чайник А" },
  { productId: "p2", title: "Чайник Б" },
  { productId: "p3", title: "Чайник В" },
];

describe("Светлана помнит показанные товары", () => {
  it("понимает «эти два», «первый», «последний» и «их»", () => {
    expect(detectReference("сравни эти два")).toEqual({ kind: "count", count: 2 });
    expect(detectReference("добавь первый в корзину")).toEqual({ kind: "index", index: 0 });
    expect(detectReference("подробнее про последний")).toEqual({ kind: "index", index: -1 });
    expect(detectReference("что лучше из них")).toEqual({ kind: "all" });
    expect(detectReference("найди чайник до 3000")).toBeNull();
    expect(detectReference("купи подарок его маме на день рождения в субботу")).toBeNull();
  });

  it("выполняет действие точно по показанным товарам", () => {
    expect(planReferenceAction("сравни эти два", shown)).toMatchObject({ tool: "compare_products", args: { productIds: ["p1", "p2"] } });
    expect(planReferenceAction("добавь второй в корзину", shown)).toMatchObject({ tool: "cart_add", args: { productId: "p2", quantity: 1 } });
    expect(planReferenceAction("отзывы на третий", shown)).toMatchObject({ tool: "get_reviews", args: { productId: "p3" } });
    expect(planReferenceAction("сравни эти два", [])).toBeNull();
    expect(planReferenceAction("найди кружку", shown)).toBeNull();
  });

  it("подставляет товары, если модель передала текст вместо кода", () => {
    expect(resolveToolArgs("compare_products", { query: "эти два" }, "сравни эти два", shown)).toEqual({ productIds: ["p1", "p2"] });
    expect(resolveToolArgs("get_reviews", { query: "второй" }, "что пишут про второй", shown)).toEqual({ productId: "p2" });
    expect(resolveToolArgs("search_products", { query: "чайник" }, "сравни эти два", shown)).toEqual({ query: "чайник" });
  });

  it("достаёт товары даже из обрезанного результата и выбирает нужный список", () => {
    const output = JSON.stringify({ ok: true, data: { items: [{ productId: "c1", title: "Кружка \"Мама\"" }, { productId: "c2", title: "Кружка Б" }] } }).slice(0, 80);
    expect(extractShownItems(output)).toEqual([{ productId: "c1", title: "Кружка \"Мама\"" }]);
    const single = [{ productId: "x", title: "Открытая карточка" }];
    expect(chooseShown([single, shown], "сравни эти два")).toBe(shown);
    expect(chooseShown([single, shown], "добавь его в корзину")).toBe(single);
  });
});

describe("тексты по-русски", () => {
  it("убирает служебные коды и английские слова", () => {
    expect(ruText("Health score: 40/100.")).toBe("Качество карточки: 40/100.");
    expect(ruText("2 карточек с низким health score")).toBe("2 карточек с низкой оценкой качества");
    expect(ruText("health 40/100, 5 просмотров")).toBe("качество 40/100, 5 просмотров");
    expect(ruText("статус карточки: DRAFT")).toBe("статус карточки: черновик");
    expect(ruText("Наличие подтверждено: AVAILABLE, количество 3.")).toBe("Наличие подтверждено: в наличии, количество 3.");
    expect(ruText("Не хватает документов: certificate, license.")).toBe("Не хватает документов: сертификат, лицензия.");
    expect(ruText("недоступны — PENDING_EXTERNAL_ACCESS.")).toBe("недоступны — ждёт подключения доступа.");
  });

  it("не портит названия товаров", () => {
    expect(ruText("Кроссовки Nike LIMITED edition")).toBe("Кроссовки Nike LIMITED edition");
    expect(ruText("Ключ Windows license")).toBe("Ключ Windows license");
    expect(ruText(undefined)).toBeUndefined();
  });
});

describe("предупреждения об остатке", () => {
  it("различает «мало» и «закончился»", () => {
    expect(stockLevel(0)).toBe("out");
    expect(stockLevel(3)).toBe("low");
    expect(stockLevel(4)).toBeNull();
    expect(stockAlertUrl("p1", "low")).not.toBe(stockAlertUrl("p1", "out"));
    expect(stockAlertText("Чайник", 2, "low").title).toBe("Заканчивается «Чайник»: осталось 2 шт.");
    expect(stockAlertText("Чайник", 0, "out").title).toBe("Закончился товар «Чайник»");
  });
});
