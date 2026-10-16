import { describe, expect, it } from "vitest";
import { formatTemp, openMeteoUrl, parseOpenMeteo, weatherLook } from "../src/lib/weather";
import { cityCookieString, readCityCookie } from "../src/lib/my-city";
import { MAP_VIEW, mapPoint, mapTiles } from "../src/lib/city-map";
import { allCities } from "../src/lib/geo-data";

describe("погода и мой город", () => {
  it("разбирает ответ Open-Meteo и отбрасывает мусор", () => {
    expect(parseOpenMeteo({ current: { temperature_2m: 12.4, weather_code: 3, is_day: 1 } })).toEqual({ temp: 12.4, code: 3, isDay: true });
    expect(parseOpenMeteo({ current: { temperature_2m: -5, weather_code: 71, is_day: 0 } })?.isDay).toBe(false);
    expect(parseOpenMeteo({ current: { temperature_2m: "12", weather_code: 3 } })).toBeNull();
    expect(parseOpenMeteo({ error: true })).toBeNull();
    expect(parseOpenMeteo(null)).toBeNull();
  });

  it("температура со знаком и значок погоды", () => {
    expect(formatTemp(12.4)).toBe("+12°");
    expect(formatTemp(-0.3)).toBe("0°");
    expect(formatTemp(-3.6)).toBe("−4°");
    expect(weatherLook(0).label).toBe("Ясно");
    expect(weatherLook(0, false).emoji).toBe("🌙");
    expect(weatherLook(73).label).toBe("Снег");
    expect(weatherLook(95).label).toBe("Гроза");
    expect(weatherLook(1234).label).toBe("Погода");
    expect(openMeteoUrl(55.79, 49.12).includes("latitude=55.79&longitude=49.12")).toBe(true);
  });

  it("кука города туда и обратно, кириллица и пробелы", () => {
    const s = cityCookieString("Нижний Новгород");
    const pair = s.split(";")[0];
    expect(readCityCookie(`a=1; ${pair}; b=2`)).toBe("Нижний Новгород");
    expect(readCityCookie("a=1")).toBeNull();
    expect(readCityCookie("aiko_city=%E0%A4%A")).toBeNull();
    expect(readCityCookie(undefined)).toBeNull();
    expect(s.includes("Max-Age=")).toBe(true);
  });

  it("все города попадают в окно карты, тайлы закрывают окно", () => {
    for (const c of allCities()) {
      const p = mapPoint(c.lat, c.lon);
      expect(p.x >= 0 && p.x <= MAP_VIEW.width && p.y >= 0 && p.y <= MAP_VIEW.height).toBe(true);
    }
    const tiles = mapTiles();
    expect(tiles.length).toBe(12);
    expect(tiles.every((t) => t.url.startsWith("https://tile.openstreetmap.org/3/"))).toBe(true);
    const moscow = mapPoint(55.76, 37.62);
    const vlad = mapPoint(43.12, 131.89);
    expect(moscow.x < vlad.x && moscow.y < vlad.y).toBe(true);
  });
});
