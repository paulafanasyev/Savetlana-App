import { describe, it, expect } from "vitest";
import { cleanMessage, buildInbox, promoPrice, promoState, UserFacingError } from "../src/lib/domains/engagement-rules";

describe("переписка покупателя и продавца", () => {
  it("чистит текст и не пропускает пустое или слишком длинное", () => {
    expect(cleanMessage("  привет\n\n\n\nкак дела  ")).toBe("привет\n\nкак дела");
    expect(() => cleanMessage("   ")).toThrow(UserFacingError);
    expect(() => cleanMessage("x".repeat(1001))).toThrow("длиннее 1000");
  });

  it("собирает список переписок: свежие сверху, считает непрочитанные входящие", () => {
    const at = (m: number) => new Date(2026, 9, 13, 10, m);
    const inbox = buildInbox([
      { counterpartId: "a", body: "старое", createdAt: at(1), incoming: true, read: true },
      { counterpartId: "b", body: "b1", createdAt: at(5), incoming: true, read: false },
      { counterpartId: "a", body: "новое", createdAt: at(9), incoming: false, read: false },
      { counterpartId: "b", body: "b0", createdAt: at(2), incoming: true, read: false },
    ]);
    expect(inbox.map((t) => t.counterpartId)).toEqual(["a", "b"]);
    expect(inbox[0]).toMatchObject({ lastBody: "новое", unread: 0, lastIncoming: false });
    expect(inbox[1]).toMatchObject({ lastBody: "b1", unread: 2 });
  });
});

describe("акции продавца", () => {
  it("считает цену со скидкой до рубля", () => {
    expect(promoPrice(999000, 10)).toBe(899100);
    expect(promoPrice(19900, 15)).toBe(16900);
  });

  it("не даёт скидку вне 5–70% и на копеечный товар", () => {
    expect(() => promoPrice(10000, 3)).toThrow("от 5 до 70");
    expect(() => promoPrice(10000, 80)).toThrow("от 5 до 70");
    expect(() => promoPrice(100, 10)).toThrow("маленькая");
  });

  it("распознаёт товар со скидкой только когда зачёркнутая цена выше текущей", () => {
    expect(promoState({ priceKopecks: 899100, oldPriceKopecks: 999000 })).toEqual({ onPromo: true, percent: 10 });
    expect(promoState({ priceKopecks: 1000, oldPriceKopecks: 900 }).onPromo).toBe(false);
    expect(promoState({ priceKopecks: 1000, oldPriceKopecks: null }).onPromo).toBe(false);
  });
});
