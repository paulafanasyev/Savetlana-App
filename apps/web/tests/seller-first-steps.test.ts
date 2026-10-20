import { describe, expect, it } from "vitest";
import { firstSteps } from "../src/lib/seller-first-steps";

const base = { verification: "NOT_SUBMITTED", activeProducts: 0, draftProducts: 0, shipCity: null, telegramLinked: false, telegramConfigured: true };

describe("Первые шаги продавца", () => {
  it("новому продавцу все шаги не сделаны", () => {
    const steps = firstSteps(base)!;
    expect(steps.map((s) => s.key)).toEqual(["apply", "product", "city", "telegram"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("блок пропадает, когда магазин одобрен и есть опубликованный товар", () => {
    expect(firstSteps({ ...base, verification: "APPROVED", activeProducts: 1 })).toBeNull();
  });

  it("без настроенного бота шага Telegram нет", () => {
    const steps = firstSteps({ ...base, telegramConfigured: false })!;
    expect(steps.some((s) => s.key === "telegram")).toBe(false);
  });

  it("черновики до одобрения: честно пишем, что публикация после одобрения", () => {
    const product = firstSteps({ ...base, verification: "PENDING", draftProducts: 2 })!.find((s) => s.key === "product")!;
    expect(product.done).toBe(false);
    expect(product.hint).toContain("после одобрения");
  });
});
