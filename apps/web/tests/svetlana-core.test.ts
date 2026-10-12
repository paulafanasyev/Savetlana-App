import { describe, it, expect, vi, afterEach } from "vitest";
import { SvetlanaCoreProvider, toCoreBody, coreChatUrl } from "../src/lib/ai/providers/core";

describe("единая Светлана (SvetlanaCoreProvider)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("system отдельно, последнее сообщение пользователя — message, tool-сообщения не уходят", () => {
    const body = toCoreBody([
      { role: "system", content: "агент поиска" },
      { role: "user", content: "найди наушники" },
      { role: "tool", content: "{\"items\":[]}", toolCallId: "c1" },
      { role: "assistant", content: "есть три варианта" },
      { role: "user", content: "а дешевле?" },
    ]);
    expect(body).toEqual({
      message: "а дешевле?",
      history: [
        { role: "user", content: "найди наушники" },
        { role: "assistant", content: "есть три варианта" },
      ],
      system: "агент поиска",
    });
  });

  it("JSON-режим добавляет инструкцию, лимиты сервера соблюдаются", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const body = toCoreBody([...many, { role: "user", content: "x".repeat(20000) }], true);
    expect(body.history.length).toBe(10);
    expect(body.message.length).toBe(16000);
    expect(body.system).toMatch(/JSON/);
  });

  it("без сообщения пользователя — ошибка", () => {
    expect(() => toCoreBody([{ role: "system", content: "s" }])).toThrow();
  });

  it("выключен без адреса и ключа и без https", () => {
    expect(new SvetlanaCoreProvider(undefined, undefined).available).toBe(false);
    expect(new SvetlanaCoreProvider("http://svetlana.example", "k").available).toBe(false);
    expect(new SvetlanaCoreProvider("https://svetlana.example", "k").available).toBe(true);
  });

  it("задачи с инструментами и эмбеддинги не берёт", () => {
    const p = new SvetlanaCoreProvider("https://svetlana.example", "k");
    const tool = { type: "function" as const, function: { name: "search", description: "", parameters: {} } };
    expect(p.supports({ taskClass: "conversation", messages: [], traceId: "t", tools: [tool] })).toBe(false);
    expect(p.supports({ taskClass: "embedding", messages: [], traceId: "t" })).toBe(false);
    expect(p.supports({ taskClass: "conversation", messages: [], traceId: "t" })).toBe(true);
  });

  it("запрос идёт на профиль aiko с ключом и возвращает текст", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ site: "aiko", content: "Подобрала три товара на АИКО" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new SvetlanaCoreProvider("https://svetlana.example/", "secret-key");
    const r = await p.complete({ taskClass: "conversation", messages: [{ role: "user", content: "наушники" }], traceId: "t1" });
    expect(r.content).toContain("АИКО");
    expect(r.sandbox).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(coreChatUrl("https://svetlana.example"));
    expect(url).toBe("https://svetlana.example/api/v1/assistant/aiko/chat");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });

  it("ошибка сервера и пустой ответ — исключение (шлюз перейдёт к следующему провайдеру)", async () => {
    const p = new SvetlanaCoreProvider("https://svetlana.example", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(p.complete({ taskClass: "conversation", messages: [{ role: "user", content: "hi" }], traceId: "t2" })).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: "" }), { status: 200 })));
    await expect(p.complete({ taskClass: "conversation", messages: [{ role: "user", content: "hi" }], traceId: "t3" })).rejects.toThrow();
  });
});
