import { describe, expect, it } from "vitest";
import { badgeText, splitUnread, totalUnread } from "../src/lib/unread";

describe("счётчики непрочитанного в шапке", () => {
  it("делит уведомления на сообщения, сообщения магазину и остальное", () => {
    const c = splitUnread([
      { kind: "seller_message", count: 2 },
      { kind: "classified_reply", count: 3 },
      { kind: "classified_answer", count: 1 },
      { kind: "buyer_message", count: 4 },
      { kind: "order_status", count: 5 },
      { kind: "review_published", count: -1 },
    ]);
    expect(c).toEqual({ messages: 6, sellerMessages: 4, other: 5 });
    expect(totalUnread(c)).toBe(15);
    expect(totalUnread(null)).toBe(0);
  });

  it("значок: пусто для нуля, 99+ для больших чисел", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(Number.NaN)).toBe("");
  });
});
