import { describe, it, expect } from "vitest";
import { MockAiProvider, draftArgs } from "../src/lib/ai/providers/mock";
import { routeAgent } from "../src/lib/ai/agents/router";

// Находки критиков: продавец спрашивает цену, заказы, просит карточку;
// покупатель пишет «дешевле» и про подарок ребёнку.
const engine = new MockAiProvider();

function ask(text: string) {
  return engine.complete({ taskClass: "reasoning", traceId: "critics-test", tools: [], messages: [{ role: "user", content: text }] });
}

describe("Светлана: продавец и покупатель (раунд критиков)", () => {
  it("«какую цену поставить» идёт в совет по цене", async () => {
    const res = await ask("Какую цену поставить на мой товар?");
    expect(res.toolCalls?.[0]?.name).toBe("advise_price");
    expect(routeAgent("Какую цену поставить на мой товар?", "seller").agent).toBe("pricing");
  });

  it("карточка товара получает название и цену из фразы", async () => {
    const res = await ask("Создай карточку товара кроссовки Nike за 9990");
    expect(res.toolCalls?.[0]?.name).toBe("create_product_draft");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ title: "Кроссовки Nike", priceRub: 9990 });
    expect(draftArgs("Создай карточку товара чайник стеклянный за 1 990 руб")).toEqual({ title: "Чайник стеклянный", priceRub: 1990 });
  });

  it("заказы покупателей в кабинете продавца", async () => {
    const res = await ask("Где заказы покупателей?");
    expect(res.toolCalls?.[0]?.name).toBe("get_order");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ scope: "seller" });
  });

  it("одно слово «дешевле» уточняет, что искать", async () => {
    const res = await ask("дешевле");
    expect(res.toolCalls ?? []).toHaveLength(0);
    expect(res.content).toContain("что именно ищем");
  });

  it("«наушники дешевле 5000» ищет наушники с бюджетом", async () => {
    const res = await ask("наушники дешевле 5000");
    expect(res.toolCalls?.[0]?.name).toBe("search_cheaper");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ query: "наушники", maxPrice: 5000 });
  });

  it("подарок ребёнку понимает получателя", async () => {
    const res = await ask("Что подарить ребёнку на день рождения");
    expect(res.toolCalls?.[0]?.name).toBe("plan_gift");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ recipientName: "ребёнок" });
  });

  it("возврат объясняет кнопку «Оформить возврат»", async () => {
    expect((await ask("Как вернуть товар?")).content).toContain("Оформить возврат");
  });
});
