import { describe, expect, it } from "vitest";
import { buildVocabulary, correctQuery, editDistance } from "../src/lib/search-relevance";

const catalog = [
  "Кроссовки Nike Air Zoom Pegasus 41, мужские",
  "Беспроводные наушники Harmonia Pro с шумоподавлением",
  "Ноутбук Aurora 14, Core i5, 16 ГБ",
  "Набор ножей из дамасской стали",
  "Перчатки рабочие ХБ с ПВХ",
].map((t) => t.toLowerCase());
const vocab = buildVocabulary(catalog);
const hasMatch = (stem: string) => catalog.some((t) => t.includes(stem));

describe("исправление опечаток", () => {
  it("считает расстояние с перестановкой и останавливается рано", () => {
    expect(editDistance("ноутбк", "ноутбук")).toBe(1);
    expect(editDistance("наушинки", "наушники")).toBe(1);
    expect(editDistance("кот", "слонопотам", 2)).toBe(3);
  });

  it("исправляет слова, которых нет в каталоге", () => {
    const a = correctQuery("кросовки мужские", vocab, hasMatch);
    expect(a.fixes).toEqual([{ from: "кросовки", to: "кроссовки" }]);
    expect(a.corrected).toBe("кроссовки мужские");
    expect(correctQuery("кросовок", vocab, hasMatch).fixes[0]?.to).toBe("кроссовки");
    expect(correctQuery("наушинки", vocab, hasMatch).corrected).toBe("наушники");
    expect(correctQuery("перчатики", vocab, hasMatch).corrected).toBe("перчатки");
  });

  it("не трогает найденные, короткие и совсем чужие слова", () => {
    expect(correctQuery("нож", vocab, hasMatch).corrected).toBeNull();
    expect(correctQuery("наушники", vocab, hasMatch).corrected).toBeNull();
    expect(correctQuery("слонопотам", vocab, hasMatch).corrected).toBeNull();
    expect(correctQuery("rtx4060", vocab, hasMatch).corrected).toBeNull();
  });
});
