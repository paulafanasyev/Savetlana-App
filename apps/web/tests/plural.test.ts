import { describe, expect, it } from "vitest";
import { countText, plural, REVIEW_FORMS } from "../src/lib/format";

describe("склонение после числа", () => {
  it("отзыв / отзыва / отзывов", () => {
    const cases: [number, string][] = [
      [0, "отзывов"], [1, "отзыв"], [2, "отзыва"], [4, "отзыва"], [5, "отзывов"],
      [11, "отзывов"], [12, "отзывов"], [14, "отзывов"], [21, "отзыв"], [22, "отзыва"],
      [101, "отзыв"], [111, "отзывов"], [112, "отзывов"], [1001, "отзыв"],
    ];
    for (const [n, word] of cases) expect(plural(n, REVIEW_FORMS), String(n)).toBe(word);
  });
  it("число и слово вместе", () => {
    expect(countText(1, REVIEW_FORMS)).toBe("1 отзыв");
    expect(countText(1.5, ["час", "часа", "часов"])).toBe("1,5 часа");
  });
});
