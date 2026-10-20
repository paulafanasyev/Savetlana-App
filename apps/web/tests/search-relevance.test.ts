import { describe, expect, it } from "vitest";
import { FALLBACK_MAX, queryTerms, relevantIds, stemTerm } from "../src/lib/search-relevance";

describe("релевантность поиска", () => {
  it("отрезает окончания только у длинных слов", () => {
    expect(stemTerm("нож")).toBe("нож");
    expect(stemTerm("кроссовки")).toBe("кроссов");
    expect("кроссовок".includes(stemTerm("кроссовки"))).toBe(true);
    expect("перчаток".includes(stemTerm("перчатки"))).toBe(true);
  });

  it("разбирает запрос: регистр, ё, знаки, короткие слова", () => {
    expect(queryTerms("Нож, для кухни!")).toEqual(["нож", "для", "кухни"]);
    expect(queryTerms("чёрные")).toEqual(["черн"]);
    expect(queryTerms("  ")).toEqual([]);
  });

  it("оставляет совпадения слов и сильную близость, убирает шум", () => {
    const { ids, fallback } = relevantIds([
      { id: "knives", kw: 7, sem: 0.32 },
      { id: "sneakers", kw: 0, sem: 0.22 },
      { id: "phone", kw: 0, sem: 0.17 },
      { id: "close", kw: 0, sem: 0.35 },
    ]);
    expect([...ids].sort()).toEqual(["close", "knives"]);
    expect(fallback).toBe(false);
  });

  it("без совпадений даёт несколько ближайших или ничего", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, kw: 0, sem: 0.26 + i / 1000 }));
    const near = relevantIds(rows);
    expect(near.fallback).toBe(true);
    expect(near.ids.size).toBe(FALLBACK_MAX);
    expect(near.ids.has("p9")).toBe(true);
    expect(relevantIds([{ id: "x", kw: 0, sem: 0.1 }]).ids.size).toBe(0);
  });
});
