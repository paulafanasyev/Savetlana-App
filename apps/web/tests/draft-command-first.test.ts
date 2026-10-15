import { describe, expect, it } from "vitest";
import { draftCommandFirst, isDraftCommand } from "../src/lib/ai/providers/draft-first";
import type { AiCompleteRequest, AiProvider } from "../src/lib/ai/types";

const inner: AiProvider = {
  key: "mock",
  displayName: "sandbox-rule-engine",
  available: true,
  sandbox: true,
  async complete() {
    return { content: "другое правило", provider: "mock", model: "m", latencyMs: 1, sandbox: true };
  },
};
const provider = draftCommandFirst(inner);
const ask = (content: string, extra: Partial<AiCompleteRequest> = {}): AiCompleteRequest => ({
  taskClass: "reasoning",
  traceId: "t",
  messages: [{ role: "system", content: "s" }, { role: "user", content }],
  ...extra,
});

describe("просьба создать карточку важнее других правил", () => {
  it("узнаёт просьбу только в начале сообщения", () => {
    expect(isDraftCommand("Создай карточку: термокружка, доставка по России, 990 ₽")).toBe(true);
    expect(isDraftCommand("Светлана, оформи товар чайник Bosch за 2990")).toBe(true);
    expect(isDraftCommand("сделай карточку товара кружка за 300")).toBe(true);
    expect(isDraftCommand("как добавить товар?")).toBe(false);
    expect(isDraftCommand("сделай товар дешевле")).toBe(false);
    expect(isDraftCommand("сделай скидку 10% на товары")).toBe(false);
    expect(isDraftCommand("оформи товар в корзину")).toBe(false);
  });

  it("создаёт черновик, даже если в описании есть доставка и подарок", async () => {
    const r = await provider.complete(ask("Создай карточку товара термокружка, доставка по России, отличный подарок, за 990"));
    expect(r.toolCalls?.[0]?.name).toBe("create_product_draft");
    expect(r.toolCalls?.[0]?.arguments).toMatchObject({ priceRub: 990 });
  });

  it("без описания товара просит его, а не создаёт пустой черновик", async () => {
    const r = await provider.complete(ask("создай карточку"));
    expect(r.toolCalls).toBeUndefined();
    expect(r.content).toContain("Напишите, что за товар");
  });

  it("остальное и ответы после инструментов идут как раньше", async () => {
    expect((await provider.complete(ask("где мой заказ"))).content).toBe("другое правило");
    expect((await provider.complete(ask("создай карточку: кружка", { jsonMode: true }))).content).toBe("другое правило");
    const afterTool = ask("создай карточку: кружка");
    afterTool.messages.push({ role: "tool", content: "{}", toolCallId: "x" });
    expect((await provider.complete(afterTool)).content).toBe("другое правило");
  });
});
