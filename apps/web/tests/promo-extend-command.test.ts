import { describe, expect, it } from "vitest";
import { parsePromoExtendCommand, PROMO_EXTEND_ASK, promoExtendReply } from "../src/lib/ai/promo-extend-command";

describe("просьба продлить скидку", () => {
  it("понимает товары и срок", () => {
    expect(parsePromoExtendCommand("Продли скидку на кроссовки на 7 дней")).toEqual({ query: "кроссовки", days: 7 });
    expect(parsePromoExtendCommand("продли все скидки на неделю")).toEqual({ query: "", days: 7 });
    expect(parsePromoExtendCommand("Продлите акцию для чайников на 3 дня!")).toEqual({ query: "чайников", days: 3 });
  });

  it("без срока возвращает только товары", () => {
    expect(parsePromoExtendCommand("продли скидку на кроссовки")).toEqual({ query: "кроссовки" });
  });

  it("не путает с другими просьбами", () => {
    expect(parsePromoExtendCommand("продли размещение товара")).toBeNull();
    expect(parsePromoExtendCommand("сделай скидку 10% на кроссовки")).toBeNull();
    expect(parsePromoExtendCommand("верни обычную цену")).toBeNull();
  });

  it("отвечает по-русски", () => {
    expect(PROMO_EXTEND_ASK).toContain("На сколько дней");
    expect(promoExtendReply({ query: "кроссовки", days: 7 })).toBe("Проверю, какие скидки на «кроссовки» можно продлить, и покажу новые даты.");
    expect(promoExtendReply({ query: "", days: 7 })).toBe("Проверю, какие скидки можно продлить, и покажу новые даты.");
  });
});
