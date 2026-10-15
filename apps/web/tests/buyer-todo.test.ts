import { describe, expect, it } from "vitest";
import { BUYER_TODO_STATUSES, buyerTodo, fullyReviewedOrders } from "../src/lib/buyer-todo";
import { BUYER_TODAY_EMPTY, todayAnswer } from "../src/lib/ai/today-command";

const order = (id: string, status: string, number = `SV-${id}`) => ({ id, number, status });

describe("покупатель: что сделать сегодня", () => {
  it("один заказ ведёт на его страницу", () => {
    expect(buyerTodo([order("o1", "PAYMENT_PENDING")])).toEqual([{ kind: "pay", href: "/orders/o1", text: "Оплатите заказ SV-o1" }]);
    expect(buyerTodo([order("o2", "READY")])[0].text).toBe("Заберите заказ SV-o2: он готов к выдаче");
  });

  it("несколько заказов ведут в список", () => {
    expect(buyerTodo([order("a", "CREATED"), order("b", "PAYMENT_PENDING")])).toEqual([{ kind: "pay", href: "/orders", text: "Ждут оплаты заказов: 2" }]);
    expect(buyerTodo([order("a", "DISPUTED"), order("b", "DISPUTED")])[0].href).toBe("/disputes");
  });

  it("сначала споры, потом оплата, в конце заказы в пути", () => {
    const kinds = buyerTodo([order("t", "IN_TRANSIT"), order("p", "CREATED"), order("d", "DISPUTED"), order("r", "DELIVERED")]).map((i) => i.kind);
    expect(kinds).toEqual(["dispute", "pay", "review", "in_transit"]);
  });

  it("не показывает завершённые и подозрительные ссылки", () => {
    expect(buyerTodo([order("c", "COMPLETED"), order("x", "CANCELLED")])).toEqual([]);
    expect(buyerTodo([order("../admin", "CREATED")])[0].href).toBe("/orders");
    expect(BUYER_TODO_STATUSES).toContain("PAYMENT_PENDING");
    expect(BUYER_TODO_STATUSES.includes("COMPLETED")).toBe(false);
  });

  it("отвечает списком или говорит, что дел нет", () => {
    expect(todayAnswer(buyerTodo([order("o1", "CREATED")]), BUYER_TODAY_EMPTY)).toBe("Вот что стоит сделать сегодня, по порядку:\n1. [Оплатите заказ SV-o1](/orders/o1)");
    expect(todayAnswer([], BUYER_TODAY_EMPTY)).toBe(BUYER_TODAY_EMPTY);
  });

  it("не напоминает про отзыв, если он уже написан на все товары", () => {
    const delivered = [
      { id: "d1", items: [{ productId: "p1" }, { productId: "p2" }] },
      { id: "d2", items: [{ productId: "p3" }] },
    ];
    const reviewed = fullyReviewedOrders(delivered, [
      { orderId: "d1", productId: "p1" },
      { orderId: "d1", productId: "p2" },
      { orderId: "d2", productId: "p9" },
      { orderId: null, productId: "p3" },
    ]);
    expect([...reviewed]).toEqual(["d1"]);
    expect(buyerTodo([order("d1", "DELIVERED"), order("d2", "DELIVERED")], reviewed)).toEqual([
      { kind: "review", href: "/orders/d2", text: "Заказ SV-d2 доставлен: проверьте товар и оставьте отзыв" },
    ]);
    expect(buyerTodo([order("d1", "DELIVERED")], reviewed)).toEqual([]);
    expect(fullyReviewedOrders([{ id: "e", items: [] }], []).size).toBe(0);
  });
});
