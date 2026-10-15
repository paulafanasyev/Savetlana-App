import { describe, expect, it } from "vitest";
import { buyerTodo, parseBuyerTodoItems } from "../src/lib/buyer-todo";

describe("блок «Что сделать сегодня» в «Моих заказах»", () => {
  it("принимает список с сервера", () => {
    const items = buyerTodo([
      { id: "o1", number: "SV-1", status: "PAYMENT_PENDING" },
      { id: "a", number: "SV-2", status: "DISPUTED" },
      { id: "b", number: "SV-3", status: "DISPUTED" },
    ]);
    expect(parseBuyerTodoItems({ items })).toEqual(items);
    expect(parseBuyerTodoItems({ items: [] })).toEqual([]);
  });

  it("не показывает чужое и странное", () => {
    expect(parseBuyerTodoItems(null)).toBeNull();
    expect(parseBuyerTodoItems({ items: [{ kind: "pay", href: "https://evil.example", text: "Оплатите" }] })).toBeNull();
    expect(parseBuyerTodoItems({ items: [{ kind: "pay", href: "/seller/orders", text: "Оплатите" }] })).toBeNull();
    expect(parseBuyerTodoItems({ items: [{ kind: "pay", href: "/orders/../admin", text: "Оплатите" }] })).toBeNull();
    expect(parseBuyerTodoItems({ items: [{ kind: "hack", href: "/orders", text: "x" }] })).toBeNull();
    expect(parseBuyerTodoItems({ items: [{ kind: "pay", href: "/orders", text: "" }] })).toBeNull();
  });
});
