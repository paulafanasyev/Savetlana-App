import { describe, expect, it } from "vitest";
import { priceText } from "../src/lib/classified-fields";

describe("цена в карточке объявления", () => {
  it("продажа без приписок", () => {
    expect(priceText("SELL", {}, "1 000 ₽")).toBe("1 000 ₽");
  });
  it("аренда в месяц и посуточно", () => {
    expect(priceText("LONG_RENT", {}, "42 000 ₽")).toBe("42 000 ₽ в месяц");
    expect(priceText("RENT", {}, "42 000 ₽")).toBe("42 000 ₽ в месяц");
    expect(priceText("DAILY_RENT", {}, "3 200 ₽")).toBe("3 200 ₽ за сутки");
  });
  it("вакансия: зарплата от и до", () => {
    expect(priceText("VACANCY", { salaryTo: 90000, salaryPeriod: "month" }, "60 000 ₽")).toBe("от 60 000 ₽ до 90 000 ₽ в месяц");
  });
});
