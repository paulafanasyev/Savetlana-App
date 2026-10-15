import { describe, expect, it } from "vitest";
import { isTodayQuestion, todayAnswer } from "../src/lib/ai/today-command";
import { sellerTodo } from "../src/lib/seller-todo";

describe("Светлана: что сделать сегодня", () => {
  it("узнаёт вопрос", () => {
    expect(isTodayQuestion("Что мне сделать сегодня?")).toBe(true);
    expect(isTodayQuestion("что нужно сделать сегодня")).toBe(true);
    expect(isTodayQuestion("Какие у меня дела на сегодня")).toBe(true);
    expect(isTodayQuestion("что срочного?")).toBe(true);
    expect(isTodayQuestion("с чего начать день")).toBe(true);
  });

  it("не путает с другим", () => {
    expect(isTodayQuestion("что подарить маме")).toBe(false);
    expect(isTodayQuestion("сделай скидку 10% на кроссовки")).toBe(false);
    expect(isTodayQuestion("где мой заказ")).toBe(false);
  });

  it("отвечает списком со ссылками", () => {
    const items = sellerTodo({ orders: 2, messages: 0, disputes: 1 }, { out: 0, low: 0, promoEnding: 0 });
    const answer = todayAnswer(items);
    expect(answer.split("\n")[0]).toBe("Вот что стоит сделать сегодня, по порядку:");
    expect(answer).toContain("1. [");
    expect(answer).toContain("](/seller/disputes)");
    expect(answer).toContain("](/seller/orders)");
    expect(answer.indexOf("/seller/disputes") < answer.indexOf("/seller/orders")).toBe(true);
    expect(todayAnswer([])).toContain("Срочных дел нет");
  });
});
