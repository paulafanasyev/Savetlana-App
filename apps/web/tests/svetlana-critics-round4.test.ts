import { describe, it, expect } from "vitest";
import { raisedRecently } from "../src/lib/domains/engagement-rules";
import { MockAiProvider } from "../src/lib/ai/providers/mock";

const now = new Date("2026-10-13T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const change = (productId: string, priceFrom: number, priceTo: number, days: number) => ({
  productId,
  change: JSON.stringify({ priceFrom, priceTo }),
  createdAt: daysAgo(days),
});

async function toolFor(text: string) {
  const res = await new MockAiProvider().complete({ taskClass: "reasoning", traceId: "r4", tools: [], messages: [{ role: "user", content: text }] });
  return { name: res.toolCalls?.[0]?.name, args: res.toolCalls?.[0]?.arguments, content: res.content };
}

describe("Критики, раунд 4: честные скидки", () => {
  it("не даёт запустить скидку от только что поднятой цены", () => {
    expect([...raisedRecently([change("a", 1000, 5000, 3)], now)]).toEqual(["a"]);
  });
  it("возврат цены после прошлой акции повышением не считается", () => {
    expect(raisedRecently([change("b", 1000, 900, 10), change("b", 900, 1000, 2)], now).size).toBe(0);
  });
  it("давнее повышение цены не мешает акции", () => {
    expect(raisedRecently([change("c", 1000, 5000, 30)], now).size).toBe(0);
  });
  it("повышение выше прежней цены после снижения ловится", () => {
    expect([...raisedRecently([change("e", 1000, 900, 10), change("e", 900, 1500, 2)], now)]).toEqual(["e"]);
  });
});

describe("Критики, раунд 4: Светлана понимает покупателя", () => {
  it("подарок важнее общего поиска", async () => {
    expect(await toolFor("хочу подарок маме до 3000")).toMatchObject({ name: "plan_gift", args: { recipientName: "мама", budget: 3000 } });
  });
  it("«найди … дешевле» ищет дешевле", async () => {
    expect(await toolFor("найди кроссовки дешевле 5000")).toMatchObject({ name: "search_cheaper", args: { query: "кроссовки", maxPrice: 5000 } });
  });
  it("проблемы с заказом ведут к заказам", async () => {
    for (const q of ["мой заказ где?", "заказ не пришёл", "посылка не пришла"]) expect((await toolFor(q)).name).toBe("get_order");
  });
  it("оплата картой и возврат конкретного товара", async () => {
    expect((await toolFor("можно ли оплатить картой?")).content).toContain("Заказ оплачивается");
    expect((await toolFor("вернуть смартфон")).content).toContain("Оформить возврат");
  });
  it("«как вернуть обычную цену» продавца не путает с возвратом товара", async () => {
    expect((await toolFor("как вернуть обычную цену")).name).toBe("end_promotion");
  });
});
