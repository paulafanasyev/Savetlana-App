import { describe, expect, it } from "vitest";
import { DEMO_ADS, DEMO_REMOVE_AFTER_REAL, shouldRemoveDemo } from "../src/lib/demo-classifieds";
import { allCities } from "../src/lib/geo-data";
import { nearbyCities } from "../src/lib/nearby";
import { fieldsFor } from "../src/lib/classified-fields";

describe("примеры объявлений", () => {
  const names = new Set(allCities().map((c) => c.name));

  it("каждый пример в городе из справочника и с ценой", () => {
    for (const ad of DEMO_ADS) {
      expect(names.has(ad.city)).toBe(true);
      expect(ad.rub > 0).toBe(true);
      expect(ad.title.length > 5).toBe(true);
    }
  });

  it("есть пары соседних городов, чтобы блок «Рядом» было видно", () => {
    const near = nearbyCities("Москва", 300, 50).map((n) => n.name);
    expect(DEMO_ADS.some((a) => near.includes(a.city))).toBe(true);
    const nearKazan = nearbyCities("Казань", 300, 50).map((n) => n.name);
    expect(DEMO_ADS.some((a) => nearKazan.includes(a.city))).toBe(true);
  });

  it("характеристики примеров совпадают с полями формы, значения списков допустимые", () => {
    for (const ad of DEMO_ADS) {
      const fields = fieldsFor(ad.vertical);
      for (const [key, value] of Object.entries(ad.attrs)) {
        const f = fields.find((x) => x.key === key);
        expect(f !== undefined).toBe(true);
        if (f?.type === "select") expect(f.options?.some((o) => o.value === value) ?? false).toBe(true);
        if (f?.type === "number") expect(typeof value).toBe("number");
      }
    }
  });

  it("примеры убираются, когда настоящих объявлений достаточно", () => {
    expect(shouldRemoveDemo(0)).toBe(false);
    expect(shouldRemoveDemo(DEMO_REMOVE_AFTER_REAL - 1)).toBe(false);
    expect(shouldRemoveDemo(DEMO_REMOVE_AFTER_REAL)).toBe(true);
  });
});
