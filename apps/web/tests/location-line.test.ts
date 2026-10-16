import { describe, expect, it } from "vitest";
import { isDemoAd, locationLine } from "../src/lib/location-line";

describe("строка места объявления", () => {
  it("Москва не повторяется", () => {
    expect(locationLine({ cityName: "Москва", regionName: "Москва" })).toBe("");
    expect(locationLine({ cityName: "Москва", regionName: "Москва", districtName: "Хамовники" })).toBe("Хамовники");
  });
  it("область, район и адрес", () => {
    expect(locationLine({ cityName: "Химки", regionName: "Московская область", districtName: "Левобережный", addressLine: "ул. Мира, 1" })).toBe("Московская область · Левобережный · ул. Мира, 1");
  });
  it("пример узнаётся по метке", () => {
    expect(isDemoAd({ demo: true })).toBe(true);
    expect(isDemoAd({ demo: "true" })).toBe(false);
    expect(isDemoAd({})).toBe(false);
  });
});
