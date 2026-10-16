import { describe, expect, it } from "vitest";
import { normalizeAiBaseUrl } from "../src/lib/env";

describe("адрес ИИ из настроек Vercel", () => {
  it("приводит к виду …/v1", () => {
    expect(normalizeAiBaseUrl("https://api.example.ru/v1")).toBe("https://api.example.ru/v1");
    expect(normalizeAiBaseUrl("https://api.example.ru/v1/")).toBe("https://api.example.ru/v1");
    expect(normalizeAiBaseUrl(" https://api.example.ru/v1/chat/completions ")).toBe("https://api.example.ru/v1");
    expect(normalizeAiBaseUrl("https://api.example.ru/v1/chat/completions/")).toBe("https://api.example.ru/v1");
  });
});
