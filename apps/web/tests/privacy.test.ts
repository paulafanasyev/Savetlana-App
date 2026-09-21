import { describe, it, expect } from "vitest";
import { classifyText, redactForModel } from "../src/lib/ai/privacy";

describe("privacy guard", () => {
  it("detects secret-like tokens", () => {
    expect(classifyText("sk_live_1234567890abcdef1234567890").dataClass).toBe("SECRET");
    expect(classifyText("Bearer eyJhbGciOiJIUzI1NiJ9.secret.token.value.here").dataClass).toBe("SECRET");
    expect(classifyText("AI_GATEWAY_API_KEY=abc123").dataClass).toBe("SECRET");
  });

  it("detects financial credentials", () => {
    expect(classifyText("Карта 4111 1111 1111 1111").dataClass).toBe("SENSITIVE_FINANCIAL");
    expect(classifyText("счёт 40817810099910004312").dataClass).toBe("SENSITIVE_FINANCIAL");
  });

  it("classifies public catalog text as public", () => {
    expect(classifyText("Ноутбук Aurora 14, i5/16/512").dataClass).toBe("PUBLIC");
  });

  it("detects personal contacts", () => {
    expect(classifyText("ivan@example.com").findings).toContain("personal-contact");
    expect(classifyText("+7 999 123 45 67").findings).toContain("personal-contact");
  });

  it("redacts secrets and cards, never leaks them", () => {
    const out = redactForModel("Карта 4111 1111 1111 1111, ключ sk_live_1234567890abcdef1234567890");
    expect(out).not.toContain("4111");
    expect(out).not.toContain("sk_live");
    expect(out).toContain("красacted");
  });

  it("redacts emails by default", () => {
    expect(redactForModel("Напишите на ivan@example.com")).not.toContain("ivan@example.com");
  });

  it("keeps catalog descriptions intact", () => {
    const text = "Беспроводные наушники, шумоподавление, до 30 часов работы";
    expect(redactForModel(text)).toBe(text);
  });
});
