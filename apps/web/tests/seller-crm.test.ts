import { describe, it, expect } from "vitest";
import { buildCustomerReport, maskEmail, type CrmOrder } from "../src/lib/domains/seller-crm";
import { MockAiProvider } from "../src/lib/ai/providers/mock";
import { routeAgent } from "../src/lib/ai/agents/router";

const now = new Date("2026-10-13T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
function order(buyer: string, rub: number, days: number, title = "Кроссовки"): CrmOrder {
  return { buyerId: buyer, buyerName: buyer, buyerEmail: `${buyer}@mail.ru`, totalKopecks: rub * 100, createdAt: daysAgo(days), items: [{ titleSnapshot: title, quantity: 1 }] };
}

describe("CRM продавца", () => {
  it("сегментирует покупателей и считает показатели", () => {
    const report = buildCustomerReport([
      order("anna", 5000, 2), order("anna", 7000, 40), order("anna", 3000, 80),
      order("ivan", 4000, 5),
      order("petr", 2000, 120),
      order("olga", 1500, 10), order("olga", 2500, 20, "Наушники"),
    ], now);
    expect(report.totals.customers).toBe(4);
    expect(report.totals.repeatRatePercent).toBe(50);
    expect(report.totals.revenueKopecks).toBe(25000 * 100);
    expect(report.segments).toEqual({ VIP: 1, REGULAR: 1, NEW: 1, SLEEPING: 1, ONE_TIME: 0 });
    expect(report.customers[0]).toMatchObject({ name: "anna", segment: "VIP", ordersCount: 3 });
    expect(report.months).toHaveLength(6);
    expect(report.months[5].orders).toBe(3);
    expect(report.advice.join(" ")).toContain("Давно не заказывали: 1 покупатель");
  });

  it("без заказов честно говорит, что покупателей нет", () => {
    const report = buildCustomerReport([], now);
    expect(report.totals.customers).toBe(0);
    expect(report.advice[0]).toContain("Покупателей пока нет");
  });

  it("маскирует почту", () => {
    expect(maskEmail("anna.petrova@mail.ru")).toBe("an***@mail.ru");
  });

  it("Светлана понимает вопросы про покупателей", async () => {
    const engine = new MockAiProvider();
    for (const text of ["Кто мои постоянные покупатели?", "Открой CRM", "Покажи моих клиентов"]) {
      const res = await engine.complete({ taskClass: "reasoning", traceId: "crm", tools: [], messages: [{ role: "user", content: text }] });
      expect(res.toolCalls?.[0]?.name).toBe("seller_customers");
    }
    expect(routeAgent("Кто мои постоянные покупатели?", "seller").agent).toBe("analytics");
  });
});
