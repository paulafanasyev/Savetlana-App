import { describe, expect, it } from "vitest";
import { MAX_SAVED_SEARCHES, alertText, cleanParams, paramsKey, searchHref, searchLabel } from "../src/lib/saved-search";

describe("сохранённые поиски: параметры и тексты", () => {
  it("чистит форму: пустые и cityId=all выбрасываем, пробелы сжимаем", () => {
    expect(cleanParams({ q: "  kia   rio ", vertical: "", cityId: "all", dealType: null })).toEqual({ q: "kia rio" });
    expect(cleanParams({ q: "x".repeat(300) }).q?.length).toBe(100);
  });
  it("одинаковые поиски дают один ключ (регистр запроса не важен)", () => {
    expect(paramsKey({ q: "Kia", vertical: "auto" })).toBe(paramsKey({ vertical: "auto", q: "kia " }));
    expect(paramsKey({ q: "kia" })).not.toBe(paramsKey({ q: "kia", cityId: "c1" }));
  });
  it("ссылка без города ведёт на всю Россию, а не на «мой город»", () => {
    expect(searchHref({ q: "kia" })).toBe("/classifieds?q=kia&cityId=all");
    expect(searchHref({ vertical: "auto", cityId: "c1" })).toBe("/classifieds?vertical=auto&cityId=c1");
  });
  it("подпись по-русски", () => {
    expect(searchLabel({ q: "kia", vertical: "auto", cityId: "c1" }, { vertical: "Автомобили", city: "Москва" })).toBe("«kia» · Автомобили · г. Москва");
    expect(searchLabel({})).toBe("Все объявления · вся Россия");
  });
  it("уведомление со склонением", () => {
    expect(alertText(1, "x").title).toBe("1 новое объявление по вашему поиску");
    expect(alertText(3, "x").title).toBe("3 новых объявления по вашему поиску");
    expect(alertText(11, "x").title).toBe("11 новых объявлений по вашему поиску");
    expect(MAX_SAVED_SEARCHES).toBe(10);
  });
});
