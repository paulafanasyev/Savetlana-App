import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS, kindLabel } from "../src/lib/domains/notification-center";

describe("раздел «Уведомления»", () => {
  it("переписка не смешивается с уведомлениями", () => {
    expect([...MESSAGE_KINDS].sort()).toEqual(["buyer_message", "classified_answer", "classified_reply", "seller_message"]);
  });

  it("у каждого вида русская подпись, латиница не показывается", () => {
    const kinds = [
      "order_status", "delivery_update", "price_drop", "availability_confirmed", "gift_event", "relationship_request",
      "document_status", "dispute_update", "review_reply", "reminder", "listing_expiring", "ai_note",
      "seller_message", "buyer_message", "classified_reply", "classified_answer", "stock_low", "security", "payout_update",
    ];
    for (const k of kinds) expect(/[a-z_]/.test(kindLabel(k))).toBe(false);
    expect(kindLabel("что-то новое")).toBe("Уведомление");
  });
});
