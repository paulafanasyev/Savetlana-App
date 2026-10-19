import { describe, expect, it } from "vitest";
import { attrLabel, attrRows, attrValue } from "../src/lib/product-attrs";

describe("характеристики товара по-русски", () => {
  it("известные ключи переводятся", () => {
    expect(attrLabel("material")).toBe("Материал");
    expect(attrLabel("items")).toBe("Предметов в наборе");
    expect(attrLabel("brand")).toBe("Бренд");
    expect(attrLabel("Purpose")).toBe("Назначение");
    expect(attrLabel("pack_size")).toBe("В упаковке");
  });
  it("русские ключи продавца остаются, с большой буквы", () => {
    expect(attrLabel("цвет ручки")).toBe("Цвет ручки");
  });
  it("все ключи демо-товаров переведены", () => {
    const keys = [
      "diagonal", "ram", "ssd", "cpu", "weight", "gpu", "memory", "screen", "battery", "type", "anc", "autonomy",
      "power", "ports", "tech", "material", "items", "handle", "height", "color", "size", "density", "season",
      "waterproof", "fit", "details", "age", "bits", "magnet", "voltage", "batteries", "torque", "disc", "format",
      "deliverables", "terms", "unit", "guarantee", "brand", "purpose",
    ];
    for (const k of keys) expect(attrLabel(k), k).toMatch(/^[А-ЯЁ]/);
  });
  it("значения да/нет по-русски, пустые и служебные скрыты", () => {
    expect(attrValue(true)).toBe("да");
    expect(attrValue("no")).toBe("нет");
    const rows = attrRows({ material: "сталь", empty: "", demo: true, _internal: "x", nested: { a: 1 } });
    expect(rows.map((r) => r.label)).toEqual(["Материал"]);
  });
});
