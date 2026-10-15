import { describe, expect, it } from "vitest";
import { sellerTodo, stockText, STOCK_HREF } from "../src/lib/seller-todo";

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
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 }, [])).toEqual([]);
    expect(sellerTodo({ orders: 0, messages: 0, disputes: 0 }, null)).toEqual([]);
  });

  it("в конце товары, которые закончились или скоро закончатся", () => {
    const stock = [{ quantity: 0 }, { quantity: 2 }, { quantity: 1 }, { quantity: 3 }];
    expect(sellerTodo({ orders: 1, messages: 0, disputes: 0 }, stock)).toEqual([
      { kind: "orders", href: "/seller/orders", text: "1 заказ ждёт действия" },
      { kind: "stock_out", href: STOCK_HREF, text: "1 товар закончился" },
      { kind: "stock_low", href: STOCK_HREF, text: "3 товара скоро закончатся" },
    ]);
    expect(STOCK_HREF).toBe("/seller/products/bulk");
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
});
