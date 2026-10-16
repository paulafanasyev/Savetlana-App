import { describe, expect, it } from "vitest";
import { listMeta } from "../src/lib/ad-meta";

describe("заголовок списка объявлений", () => {
  it("раздел и город", () => {
    const m = listMeta({ section: "Авто", cityName: "Казань" });
    expect(m.title).toBe("Авто · Казань | АИКО");
    expect(m.description.startsWith("Авто в городе Казань")).toBe(true);
    expect(m.index).toBe(true);
  });
  it("без фильтров: вся Россия", () => {
    expect(listMeta({}).title).toBe("Объявления по всей России | АИКО");
  });
  it("поиск по тексту не индексируется", () => {
    expect(listMeta({ query: "kia" }).index).toBe(false);
    expect(listMeta({ query: "  " }).index).toBe(true);
  });
});
