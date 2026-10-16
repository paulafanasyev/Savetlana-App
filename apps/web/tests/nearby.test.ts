import { describe, expect, it } from "vitest";
import { distanceKm, nearbyCities } from "../src/lib/nearby";

describe("города рядом", () => {
  it("расстояние Москва — Петербург около 634 км", () => {
    const km = distanceKm({ lat: 55.76, lon: 37.62 }, { lat: 59.94, lon: 30.31 });
    expect(km > 620 && km < 650).toBe(true);
    expect(distanceKm({ lat: 55, lon: 37 }, { lat: 55, lon: 37 })).toBe(0);
  });

  it("соседи Москвы: Подмосковье есть, самой Москвы и Петербурга нет, ближние первыми", () => {
    const near = nearbyCities("москва", 300, 50);
    const names = near.map((n) => n.name);
    expect(names.includes("Химки")).toBe(true);
    expect(names.includes("Москва")).toBe(false);
    expect(names.includes("Санкт-Петербург")).toBe(false);
    for (let i = 1; i < near.length; i++) expect(near[i - 1].km <= near[i].km).toBe(true);
    expect(near.every((n) => n.km <= 300)).toBe(true);
  });

  it("Казань: Набережные Челны рядом, лимит и неизвестный город", () => {
    const near = nearbyCities("Казань", 300, 50);
    const chelny = near.find((n) => n.name === "Набережные Челны");
    expect(chelny !== undefined && chelny.km > 180 && chelny.km < 230).toBe(true);
    expect(nearbyCities("Казань", 300, 2).length <= 2).toBe(true);
    expect(nearbyCities("Атлантида")).toEqual([]);
  });
});
