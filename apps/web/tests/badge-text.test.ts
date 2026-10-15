import { describe, expect, it } from "vitest";
import { badgeLabel, badgeText, DISPUTE_ACTION_STATUSES, ORDER_ACTION_STATUSES } from "../src/lib/badge-text";

describe("счётчики в меню кабинета продавца", () => {
  it("показывает число, пусто для нуля и 99+ для больших", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(-3)).toBe("");
    expect(badgeText(Number.NaN)).toBe("");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(150)).toBe("99+");
  });

  it("подпись для диктора склоняется по-русски", () => {
    expect(badgeLabel("orders", 1)).toBe("1 заказ ждёт действия");
    expect(badgeLabel("orders", 3)).toBe("3 заказа ждут действия");
    expect(badgeLabel("orders", 12)).toBe("12 заказов ждут действия");
    expect(badgeLabel("messages", 21)).toBe("21 непрочитанное сообщение");
    expect(badgeLabel("messages", 2)).toBe("2 непрочитанных сообщения");
    expect(badgeLabel("messages", 5)).toBe("5 непрочитанных сообщений");
    expect(badgeLabel("messages", 0)).toBe("");
    expect(badgeLabel("disputes", 1)).toBe("1 спор ждёт ответа");
    expect(badgeLabel("disputes", 4)).toBe("4 спора ждут ответа");
    expect(badgeLabel("disputes", 11)).toBe("11 споров ждут ответа");
  });

  it("считает только заказы и споры, где нужен продавец", () => {
    expect([...ORDER_ACTION_STATUSES]).toEqual(["PAID", "RETURN_REQUESTED", "RETURNING"]);
    expect([...DISPUTE_ACTION_STATUSES]).toEqual(["OPEN", "EVIDENCE_COLLECTION"]);
  });
});
