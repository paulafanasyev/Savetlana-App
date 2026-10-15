import { describe, expect, it } from "vitest";
import { extendDoneText, PROMO_EXTEND_DAYS } from "../src/lib/seller-todo";

describe("кнопка «Продлить» в блоке дел", () => {
  it("продлевает на неделю", () => {
    expect(PROMO_EXTEND_DAYS).toBe(7);
  });

  it("пишет итог по-русски", () => {
    expect(extendDoneText(3, 0)).toBe("Продлено на 7 дней: 3 товара.");
    expect(extendDoneText(1, 2)).toBe("Продлено на 7 дней: 1 товар. Не продлено: 2 товара, подробности в разделе «Акции».");
    expect(extendDoneText(0, 5)).toBe("Ничего не продлено. Не продлено: 5 товаров, подробности в разделе «Акции».");
    expect(extendDoneText(Number.NaN, -1)).toBe("Ничего не продлено.");
  });
});
