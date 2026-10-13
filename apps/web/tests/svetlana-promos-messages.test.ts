import { describe, it, expect } from "vitest";
import { matchProducts } from "../src/lib/domains/engagement-rules";
import { MockAiProvider, promoTarget } from "../src/lib/ai/providers/mock";
import { routeAgent, AGENT_TOOLS } from "../src/lib/ai/agents/router";

async function toolFor(text: string) {
  const res = await new MockAiProvider().complete({ taskClass: "reasoning", traceId: "promo", tools: [], messages: [{ role: "user", content: text }] });
  return { name: res.toolCalls?.[0]?.name, args: res.toolCalls?.[0]?.arguments, content: res.content };
}

describe("Светлана: акции и сообщения", () => {
  it("находит товары продавца по словам из просьбы", () => {
    const products = [{ title: "Кроссовки Nike Air" }, { title: "Наушники Sony" }, { title: "Кроссовки Adidas" }];
    expect(matchProducts(products, "кроссовки Nike").map((p) => p.title)).toEqual(["Кроссовки Nike Air"]);
    expect(matchProducts(products, "кроссовок")).toHaveLength(2);
    expect(matchProducts(products, "все товары")).toHaveLength(3);
    expect(matchProducts(products, "телевизор")).toHaveLength(0);
  });

  it("понимает просьбу о скидке с процентом и товаром", async () => {
    expect(await toolFor("Сделай скидку 15% на кроссовки Nike")).toMatchObject({ name: "start_promotion", args: { percent: 15, query: "кроссовки Nike" } });
    expect(await toolFor("Запусти акцию на наушники 10%")).toMatchObject({ name: "start_promotion", args: { percent: 10, query: "наушники" } });
    expect(promoTarget("Сделай скидку 10% на все товары")).toBe("все товары");
  });

  it("без процента переспрашивает, а не запускает скидку", async () => {
    const res = await toolFor("Сделай скидку");
    expect(res.name).toBeUndefined();
    expect(res.content).toContain("какую скидку");
  });

  it("понимает завершение скидки и вопросы про сообщения", async () => {
    expect(await toolFor("Убери скидку с кроссовок")).toMatchObject({ name: "end_promotion", args: { query: "кроссовок" } });
    expect((await toolFor("Верни обычную цену")).name).toBe("end_promotion");
    expect((await toolFor("Есть новые сообщения?")).name).toBe("seller_messages");
    expect((await toolFor("Кто мне написал")).name).toBe("seller_messages");
  });

  it("направляет запросы нужному помощнику", () => {
    expect(routeAgent("Сделай скидку 15% на кроссовки", "seller").agent).toBe("pricing");
    expect(routeAgent("Есть новые сообщения?", "seller").agent).toBe("notification");
    expect(AGENT_TOOLS.pricing).toContain("start_promotion");
    expect(AGENT_TOOLS.notification).toContain("seller_messages");
  });
});
