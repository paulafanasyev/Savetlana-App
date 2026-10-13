import { describe, it, expect } from "vitest";
import { MockAiProvider, sourcingAnswer } from "../src/lib/ai/providers/mock";
import { routeAgent } from "../src/lib/ai/agents/router";

// Запросы продавца про закупку в Китае и поиск с «помоги найти» должны
// доходить до нужного инструмента с чистым запросом, а не до заглушки.
const engine = new MockAiProvider();

function ask(text: string) {
  return engine.complete({
    taskClass: "reasoning",
    traceId: "sourcing-test",
    tools: [],
    messages: [{ role: "user", content: text }],
  });
}

describe("Светлана: закупка и поиск", () => {
  it("закупку в Китае ведёт в глобальный поиск с чистым запросом", async () => {
    for (const text of [
      "Помоги найти кроссовки Nike с самой дешёвой стоимостью и лучшим рейтингом магазина в Китае",
      "Кроссовки Nike с лучшим рейтингом в Китае, хочу их там купить и тут продавать",
    ]) {
      const res = await ask(text);
      expect(res.toolCalls?.[0]?.name).toBe("global_search");
      const args = res.toolCalls?.[0]?.arguments as { query: string; tier: number };
      expect(args.query.toLowerCase()).toBe("кроссовки nike");
      expect(args.tier).toBe(2);
    }
  });

  it("«помоги найти» ищет в каталоге без лишних слов", async () => {
    const res = await ask("Помоги найти кроссовки Nike");
    expect(res.toolCalls?.[0]?.name).toBe("search_products");
    expect((res.toolCalls?.[0]?.arguments as { query: string }).query).toBe("кроссовки Nike");
  });

  it("без доступа к зарубежным площадкам честно говорит и даёт план закупки", () => {
    const text = sourcingAnswer({
      tier: 2,
      platformCount: 1,
      externalCount: 0,
      liveExternal: false,
      hits: [{ source: "platform", title: "Кроссовки Nike Revolution 7", priceKopecks: 649000 }],
    });
    expect(text).toContain("не выдумываю");
    expect(text).toContain("«Кроссовки Nike Revolution 7»");
    expect(text).toContain("правообладателя");
  });

  it("в кабинете продавца вопрос о Китае уходит агенту конкурентов", () => {
    expect(routeAgent("Кроссовки Nike с лучшим рейтингом в Китае, хочу их там купить", "seller").agent).toBe("competitor");
    expect(routeAgent("Помоги найти кроссовки Nike", "buyer").agent).toBe("search");
  });
});
