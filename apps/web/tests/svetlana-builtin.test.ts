import { describe, it, expect } from "vitest";
import { MockAiProvider } from "../src/lib/ai/providers/mock";

// Встроенный движок Светланы должен справляться с основными запросами сам,
// без внешней модели и без другого репозитория.
const engine = new MockAiProvider();

function ask(text: string) {
  return engine.complete({
    taskClass: "reasoning",
    traceId: "builtin-test",
    tools: [],
    messages: [{ role: "user", content: text }],
  });
}

describe("встроенная Светлана", () => {
  it("ищет товар по фразе с «найдите» и отделяет бюджет", async () => {
    const res = await ask("Найдите чайник до 3000 рублей");
    expect(res.toolCalls?.[0]?.name).toBe("search_products");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ query: "чайник", budget: 3000 });
  });

  it("короткое название товара тоже ищет в каталоге", async () => {
    const res = await ask("беспроводные наушники");
    expect(res.toolCalls?.[0]?.name).toBe("search_products");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ query: "беспроводные наушники" });
  });

  it("сама отвечает про доставку по реальным тарифам сайта", async () => {
    const res = await ask("Сколько стоит доставка?");
    expect(res.toolCalls ?? []).toHaveLength(0);
    expect(res.content).toContain("Самовывоз у продавца");
    expect(res.content).toContain("Доставка продавцом");
  });

  it("объясняет, что умеет, и как вернуть товар", async () => {
    expect((await ask("Что ты умеешь?")).content).toContain("Светлана");
    expect((await ask("Как вернуть товар?")).content).toContain("Открыть спор");
  });

  it("приветствие не превращается в поиск", async () => {
    const res = await ask("Привет");
    expect(res.toolCalls ?? []).toHaveLength(0);
    expect(res.content).toContain("Здравствуйте");
  });

  it("вопрос о заказе идёт к инструменту заказов", async () => {
    const res = await ask("Где мой заказ?");
    expect(res.toolCalls?.[0]?.name).toBe("get_order");
  });

  it("перечисляет найденные товары из результата инструмента", async () => {
    const res = await engine.complete({
      taskClass: "reasoning",
      traceId: "builtin-test-2",
      messages: [
        { role: "user", content: "чайник" },
        {
          role: "tool",
          content: JSON.stringify({
            ok: true,
            summary: "Найдено 2 предложения.",
            data: { items: [{ title: "Чайник стеклянный", priceKopecks: 199000, seller: "Дом" }, { title: "Чайник металлический", priceKopecks: 99000 }] },
          }),
        },
      ],
    });
    expect(res.content).toContain("«Чайник стеклянный»");
    expect(res.content).toContain("«Чайник металлический»");
  });

  it("честно передаёт ошибку инструмента", async () => {
    const res = await engine.complete({
      taskClass: "reasoning",
      traceId: "builtin-test-3",
      messages: [
        { role: "user", content: "чайник" },
        { role: "tool", content: JSON.stringify({ ok: false, error: "каталог недоступен" }) },
      ],
    });
    expect(res.content).toContain("Не получилось");
  });
});
