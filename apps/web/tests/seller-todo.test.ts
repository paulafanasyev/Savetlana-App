import { describe, expect, it } from "vitest";
import { endingSoon, PROMO_HREF, promoEndingText, sellerTodo, stockText, STOCK_HREF } from "../src/lib/seller-todo";

describe("что сделать сегодня в кабинете продавца", () => {
  it("споры первыми, потом заказы и сообщения, со ссылками", () => {
    expect(sellerTodo({ orders: 3, messages: 1, disputes: 1 })).toEqual([
      { kind: "disputes", href: "/seller/disputes", text: "1 спор ждёт ответа" },
      { kind: "orders", href: "/seller/orders", text: "3 заказа ждут действия" },
      { kind: "messages", href: "/seller/messages", text: "1 непрочитанное сообщение" },
    ]);
  });

  it("пропускает нули и пустой список, когда дел нет", () => {
    expect(sellerTodo({ orders: 0, messages: 5, disputes: 0 })).toEqual([
      { kind: "messages", href: "/seller/messages", text: "5 непрочитанных сообщений" },
    ]);
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 })).toEqual([]);
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 }, { out: 0, low: 0 })).toEqual([]);
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 }, null)).toEqual([]);
  });

  it("в конце товары, которые закончились или скоро закончатся", () => {
    expect(sellerTodo({ orders: 1, messages: 0, disputes: 0 }, { out: 1, low: 3 })).toEqual([
      { kind: "orders", href: "/seller/orders", text: "1 заказ ждёт действия" },
      { kind: "stock_out", href: STOCK_HREF, text: "1 товар закончился" },
      { kind: "stock_low", href: STOCK_HREF, text: "3 товара скоро закончатся" },
    ]);
    expect(STOCK_HREF).toBe("/seller/products/bulk");
    // больше десяти: считаются все, а не только первые 10 из списка на главной
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 }, { out: 0, low: 25 })).toEqual([
      { kind: "stock_low", href: STOCK_HREF, text: "25 товаров скоро закончатся" },
    ]);
  });

  it("склоняет слово «товар»", () => {
    expect(stockText("stock_out", 2)).toBe("2 товара закончились");
    expect(stockText("stock_out", 11)).toBe("11 товаров закончились");
    expect(stockText("stock_low", 1)).toBe("1 товар скоро закончится");
    expect(stockText("stock_low", 21)).toBe("21 товар скоро закончится");
    expect(stockText("stock_low", 5)).toBe("5 товаров скоро закончатся");
    expect(stockText("stock_low", 0)).toBe("");
    expect(stockText("stock_out", Number.NaN)).toBe("");
  });

  it("напоминает о скидках, которые закончатся в течение суток", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
    expect(endingSoon([h(1), h(23), h(24), h(25), h(-1), new Date("x")], now)).toBe(3);
    expect(endingSoon([], now)).toBe(0);
    expect(promoEndingText(1)).toBe("Скидка закончится в течение суток: 1 товар");
    expect(promoEndingText(3)).toBe("Скидка закончится в течение суток: 3 товара");
    expect(promoEndingText(0)).toBe("");
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 }, { out: 1, low: 0, promoEnding: 5 })).toEqual([
      { kind: "stock_out", href: STOCK_HREF, text: "1 товар закончился" },
      { kind: "promo_ending", href: PROMO_HREF, text: "Скидка закончится в течение суток: 5 товаров" },
    ]);
    expect(PROMO_HREF).toBe("/seller/promotions");
  });
});
