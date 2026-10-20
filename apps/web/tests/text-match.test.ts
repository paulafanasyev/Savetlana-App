import { describe, expect, it } from "vitest";
import { caseVariants, textMatchOr } from "../src/lib/text-match";

const hit = (title: string, q: string) => caseVariants(q).some((v) => title.includes(v));

describe("поиск без учёта регистра", () => {
  it("маленькие буквы находят обычные заголовки", () => {
    expect(hit("Пример: Kia Rio, 2020, 1.6 AT", "kia")).toBe(true);
    expect(hit("Пример: Kia Rio, 2020, 1.6 AT", "kia rio")).toBe(true);
    expect(hit("BMW X5 2019", "bmw")).toBe(true);
    expect(hit("Квартира в Москве", "москве")).toBe(true);
    expect(hit("ремонт холодильников", "РЕМОНТ")).toBe(true);
    expect(hit("Lada Granta", "kia")).toBe(false);
  });
  it("без повторов и пустого", () => {
    expect(caseVariants("  ")).toEqual([]);
    expect(new Set(caseVariants("kia")).size).toBe(caseVariants("kia").length);
  });
  it("условие для базы по каждому полю", () => {
    const or = textMatchOr("kia", ["title", "description"] as const);
    expect(or).toContainEqual({ title: { contains: "Kia" } });
    expect(or).toContainEqual({ description: { contains: "kia" } });
  });
});
