import { describe, it, expect } from "vitest";
import { routeAgent, AGENT_TOOLS, type AgentKey } from "../src/lib/ai/agents/router";

describe("agent router", () => {
  it("routes buyer search to the search agent", () => {
    expect(routeAgent("Найди ноутбук до 100 тысяч", "buyer").agent).toBe("search");
  });

  it("routes gift requests to the gift agent", () => {
    expect(routeAgent("Что подарить маме до 10000?", "buyer").agent).toBe("gift");
  });

  it("routes order questions to the order agent", () => {
    expect(routeAgent("Где мой заказ?", "buyer").agent).toBe("order");
  });

  it("routes seller sales questions to analytics", () => {
    expect(routeAgent("Почему упали продажи?", "seller").agent).toBe("analytics");
  });

  it("routes competitor questions on the seller surface", () => {
    expect(routeAgent("Кто мои конкуренты?", "seller").agent).toBe("competitor");
  });

  it("routes pricing questions to the pricing agent", () => {
    expect(routeAgent("Какую цену поставить?", "seller").agent).toBe("pricing");
  });

  it("routes vision/photo questions to the vision agent", () => {
    expect(routeAgent("Найди товар по фотографии", "buyer").agent).toBe("vision");
  });

  it("falls back to a buyer agent on unknown intent", () => {
    expect(routeAgent("случайный текст ни о чём", "buyer").agent).toBe("buyer");
  });

  it("gives every agent a non-empty tool set", () => {
    for (const key of Object.keys(AGENT_TOOLS) as AgentKey[]) {
      expect(AGENT_TOOLS[key].length).toBeGreaterThan(0);
    }
  });

  it("never lets the buyer surface publish products", () => {
    expect(AGENT_TOOLS.buyer).not.toContain("publish_product");
  });
});
