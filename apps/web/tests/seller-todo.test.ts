import { describe, expect, it } from "vitest";
import { sellerTodo } from "../src/lib/seller-todo";

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
  });
});
