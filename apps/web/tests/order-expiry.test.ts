import { describe, it, expect } from "vitest";
import { decideExpiry, UNPAID_ORDER_TTL_HOURS, UNPAID_ORDER_HARD_LIMIT_HOURS } from "../src/lib/domains/order-expiry";

const pending = { sandbox: false, status: "PENDING", providerRef: "700001" };
const live = (status: "PENDING" | "SUCCEEDED" | "FAILED") => ({ status, rawStatus: status, amountKopecks: 1000, orderId: "o1" });

describe("автоотмена неоплаченных заказов", () => {
  it("моложе 24 часов — не трогаем", () => {
    expect(decideExpiry({ ageHours: UNPAID_ORDER_TTL_HOURS - 1, payment: null })).toBe("skip");
  });

  it("без платежа, sandbox или отклонённый платёж — отменяем", () => {
    expect(decideExpiry({ ageHours: 25, payment: null })).toBe("cancel");
    expect(decideExpiry({ ageHours: 25, payment: { sandbox: true, status: "PENDING", providerRef: "sb_1" } })).toBe("cancel");
    expect(decideExpiry({ ageHours: 25, payment: { ...pending, status: "FAILED" } })).toBe("cancel");
  });

  it("банк говорит «оплачено» — проводим оплату, не отменяем", () => {
    expect(decideExpiry({ ageHours: 30, payment: pending, live: live("SUCCEEDED") })).toBe("apply_payment");
  });

  it("банк отклонил — отменяем", () => {
    expect(decideExpiry({ ageHours: 30, payment: pending, live: live("FAILED") })).toBe("cancel");
  });

  it("банк ещё ждёт — ждём до 72 часов, потом отменяем", () => {
    expect(decideExpiry({ ageHours: 30, payment: pending, live: live("PENDING") })).toBe("wait");
    expect(decideExpiry({ ageHours: UNPAID_ORDER_HARD_LIMIT_HOURS, payment: pending, live: live("PENDING") })).toBe("cancel");
  });

  it("банк недоступен — пропускаем до следующего запуска", () => {
    expect(decideExpiry({ ageHours: 100, payment: pending, live: "error" })).toBe("skip");
  });

  it("оплата уже записана — не отменяем", () => {
    expect(decideExpiry({ ageHours: 100, payment: { ...pending, status: "SUCCEEDED" } })).toBe("skip");
  });
});
