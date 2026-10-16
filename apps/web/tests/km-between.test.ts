import { describe, expect, it } from "vitest";
import { kmBetween, kmLabel } from "../src/lib/nearby";

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("расстояние между городами", () => {
  it("Москва и Химки рядом, Москва и Петербург далеко", () => {
    const near = kmBetween("Москва", "Химки");
    const far = kmBetween("москва", "Санкт-Петербург");
    expect(near !== null && near < 40).toBe(true);
    expect(far !== null && far > 600 && far < 680).toBe(true);
    expect(kmBetween("Казань", "Казань")).toBe(0);
    expect(kmBetween("Атлантида", "Москва")).toBe(null);
  });
  it("подпись", () => {
    expect(kmLabel(null)).toBe("");
    expect(kmLabel(0)).toBe("в вашем городе");
    expect(plain(kmLabel(1234))).toBe("≈ 1 234 км");
  });
});
