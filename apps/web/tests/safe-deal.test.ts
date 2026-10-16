import { describe, expect, it } from "vitest";
import { ACCEPT_DAYS, autoAcceptDue, ordersDueForAutoAccept, PAYOUT_READY_ORDER_STATUSES, safeDealBuyerNote, safeDealSellerNote } from "../src/lib/safe-deal";

const day = 86_400_000;

describe("безопасная сделка", () => {
  it("деньги продавцу только за завершённый заказ", () => {
    expect([...PAYOUT_READY_ORDER_STATUSES]).toEqual(["COMPLETED"]);
  });

  it("автоприёмка через ACCEPT_DAYS дней после доставки", () => {
    const delivered = new Date("2026-10-01T10:00:00Z");
    expect(autoAcceptDue(delivered, new Date(delivered.getTime() + (ACCEPT_DAYS - 1) * day))).toBe(false);
    expect(autoAcceptDue(delivered, new Date(delivered.getTime() + ACCEPT_DAYS * day))).toBe(true);
  });

  it("покупатель видит, где деньги", () => {
    expect(safeDealBuyerNote("PAID")).toContain("деньги у площадки");
    expect(safeDealBuyerNote("DELIVERED")).toContain("«Товар получен»");
    expect(safeDealBuyerNote("DISPUTED")).toContain("не уйдут продавцу");
    expect(safeDealBuyerNote("COMPLETED")).toBeNull();
    expect(safeDealBuyerNote("PAYMENT_PENDING")).toBeNull();
  });

  it("продавец видит, когда будут деньги", () => {
    expect(safeDealSellerNote("COMPLETED")).toContain("доступны к выплате");
    expect(safeDealSellerNote("DELIVERED")).toContain(`${ACCEPT_DAYS} дней`);
    expect(safeDealSellerNote("RETURNING")).toContain("заморожены");
  });

  it("автоприёмка считает от последней доставки и не трогает заказ без записи", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const old = new Date(now.getTime() - (ACCEPT_DAYS + 1) * day);
    const fresh = new Date(now.getTime() - day);
    const rows = [
      { orderId: "a", createdAt: old },
      { orderId: "b", createdAt: old },
      { orderId: "b", createdAt: fresh },
    ];
    expect(ordersDueForAutoAccept(["a", "b", "c"], rows, now)).toEqual(["a"]);
  });
});
