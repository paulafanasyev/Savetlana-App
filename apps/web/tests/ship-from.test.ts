import { describe, expect, it } from "vitest";
import { DEMO_SHIP_CITIES, resolveShipCity, shipFromText } from "../src/lib/ship-from";

describe("город отгрузки", () => {
  it("берёт точное название из справочника", () => {
    expect(resolveShipCity("  казань ")?.name).toBe("Казань");
    expect(resolveShipCity("Королев")?.name).toBe("Королёв");
    expect(resolveShipCity("Казань")?.regionName).toBe("Республика Татарстан");
  });
  it("неизвестный или пустой город не принимает", () => {
    expect(resolveShipCity("")).toBe(null);
    expect(resolveShipCity("Атлантида")).toBe(null);
    expect(resolveShipCity(null)).toBe(null);
  });
  it("города демо-магазинов есть в справочнике", () => {
    for (const city of Object.values(DEMO_SHIP_CITIES)) expect(resolveShipCity(city)?.name).toBe(city);
  });
  it("подпись на карточке", () => {
    expect(shipFromText("Казань")).toBe("Отправка из г. Казань");
    expect(shipFromText(null)).toBe("");
  });
});
