import { describe, expect, it } from "vitest";
import { parseTodoItems, sellerTodo } from "../src/lib/seller-todo";

describe("живой список «Что сделать сегодня»", () => {
  it("принимает список с сервера", () => {
    const items = sellerTodo({ orders: 2, messages: 0, disputes: 1 }, { out: 1, low: 0, promoEnding: 3 });
    expect(parseTodoItems({ items })).toEqual(items);
    expect(parseTodoItems({ items: [] })).toEqual([]);
  });

  it("не показывает чужое и странное", () => {
    expect(parseTodoItems(null)).toBeNull();
    expect(parseTodoItems({})).toBeNull();
    expect(parseTodoItems({ items: [{ kind: "orders", href: "https://evil.example", text: "Заказы" }] })).toBeNull();
    expect(parseTodoItems({ items: [{ kind: "orders", href: "/admin", text: "Заказы" }] })).toBeNull();
    expect(parseTodoItems({ items: [{ kind: "hack", href: "/seller/orders", text: "x" }] })).toBeNull();
    expect(parseTodoItems({ items: [{ kind: "orders", href: "/seller/orders", text: " " }] })).toBeNull();
    expect(parseTodoItems({ items: [{ kind: "orders", href: "/seller/orders/../../admin", text: "x" }] })).toBeNull();
  });
});
