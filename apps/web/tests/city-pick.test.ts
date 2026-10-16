import { describe, expect, it } from "vitest";
import { cityLabel, matchCity, suggestCities } from "../src/lib/city-pick";
import { allCities, cityCoords, DISTRICTS } from "../src/lib/geo-data";

const CITIES = [
  { id: "1", name: "Москва", regionName: "Москва" },
  { id: "2", name: "Казань", regionName: "Республика Татарстан" },
  { id: "3", name: "Королёв", regionName: "Московская область" },
  { id: "4", name: "Ростов-на-Дону", regionName: "Ростовская область" },
  { id: "5", name: "Нижний Новгород", regionName: "Нижегородская область" },
  { id: "6", name: "Нижний Тагил", regionName: "Свердловская область" },
];

describe("выбор города", () => {
  it("подпись без повтора региона для Москвы", () => {
    expect(cityLabel(CITIES[0])).toBe("Москва");
    expect(cityLabel(CITIES[1])).toBe("Казань, Республика Татарстан");
  });

  it("подсказки по началу названия, без учёта регистра, «ё» и дефисов", () => {
    expect(suggestCities("каз", CITIES).map((c) => c.id)).toEqual(["2"]);
    expect(suggestCities("королев", CITIES).map((c) => c.id)).toEqual(["3"]);
    expect(suggestCities("ростов на", CITIES).map((c) => c.id)).toEqual(["4"]);
    expect(suggestCities("нижний", CITIES).map((c) => c.id)).toEqual(["5", "6"]);
    expect(suggestCities("татарстан", CITIES).map((c) => c.id)).toEqual(["2"]);
  });

  it("точное совпадение или единственная подсказка", () => {
    expect(matchCity("Казань, Республика Татарстан", CITIES)?.id).toBe("2");
    expect(matchCity("казань", CITIES)?.id).toBe("2");
    expect(matchCity("ниж", CITIES)).toBeNull();
    expect(matchCity("Нижний Тагил", CITIES)?.id).toBe("6");
    expect(matchCity("", CITIES)).toBeNull();
    expect(matchCity("Париж", CITIES)).toBeNull();
  });

  it("у каждого города есть координаты в пределах России, метро без повторов", () => {
    const all = allCities();
    expect(all.length > 100).toBe(true);
    for (const c of all) {
      expect(c.lat > 41 && c.lat < 78).toBe(true);
      expect(c.lon > 19 && c.lon < 180).toBe(true);
    }
    expect(cityCoords("казань")).toEqual({ lat: 55.79, lon: 49.12 });
    expect(cityCoords("Королев") !== null).toBe(true);
    for (const d of DISTRICTS) for (const r of d.regions) for (const c of r.cities) for (const st of Object.values(c.metro ?? {})) {
      expect(new Set(st).size).toBe(st.length);
    }
  });
});
