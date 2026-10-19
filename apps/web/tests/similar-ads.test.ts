import { describe, expect, it } from "vitest";
import { pickSimilar } from "../src/lib/similar-ads";

const ads = (...ids: string[]) => ids.map((id) => ({ id }));

describe("похожие объявления", () => {
  it("не показывает само объявление и повторы", () => {
    expect(pickSimilar(ads("a", "self", "b"), ads("b", "c"), "self").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("сначала город, потом регион, не больше лимита", () => {
    expect(pickSimilar(ads("a", "b"), ads("c", "d", "e"), "x", 3).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("пусто, если ничего нет", () => {
    expect(pickSimilar(ads("self"), [], "self")).toEqual([]);
  });
});
