import { describe, expect, it } from "vitest";
import { canEdit, mergeAttrs, priceFromRub } from "../src/lib/ad-edit";

describe("редактирование объявления", () => {
  it("редактировать можно опубликованное и ждущее проверки", () => {
    expect(canEdit("PUBLISHED")).toBe(true);
    expect(canEdit("MODERATION")).toBe(true);
    expect(canEdit("REJECTED")).toBe(false);
    expect(canEdit("CLOSED")).toBe(false);
  });
  it("цена из формы", () => {
    expect(priceFromRub("")).toBe(0);
    expect(priceFromRub("1 390 000")).toBe(139000000);
    expect(priceFromRub("99,5")).toBe(9950);
    expect(priceFromRub("-5")).toBe(null);
    expect(priceFromRub("дешево")).toBe(null);
  });
  it("поля формы заменяются, служебные сохраняются", () => {
    const out = mergeAttrs("AUTO", { brand: "Kia", year: 2020, color: "белый" }, { brand: "Hyundai" });
    expect(out.brand).toBe("Hyundai");
    expect("year" in out).toBe(false);
    expect(out.color).toBe("белый");
  });
});
