import { describe, expect, it } from "vitest";
import { PROMO_PLANS, applyPlan, findPlan, isActive, parsePromotion, perDay, pickForRail, timeLeft } from "../src/lib/promo";

const NOW = new Date("2026-10-16T10:00:00Z");
const BASE = { kind: "classified" as const, itemId: "c1", ownerId: "u1", sandbox: true };

describe("продвижение в правой колонке", () => {
  it("тарифы дешевле 6 ₽ в сутки, месяц дешевле 3 ₽", () => {
    for (const p of PROMO_PLANS) expect(p.priceRub / p.days < 6).toBe(true);
    expect(findPlan("month")!.priceRub / 30 < 3).toBe(true);
    expect(findPlan("nope")).toBeNull();
    expect(perDay(findPlan("day")!)).toBe("5 ₽ в сутки");
    expect(perDay(findPlan("month")!)).toBe("2,63 ₽ в сутки");
  });

  it("новое продвижение начинается сейчас, продление добавляет дни к концу", () => {
    const week = findPlan("week")!;
    const first = applyPlan(null, week, BASE, NOW);
    expect(first.startsAt).toBe(NOW.toISOString());
    expect(first.endsAt).toBe("2026-10-23T10:00:00.000Z");
    expect(first.paidRub).toBe(29);
    const later = new Date("2026-10-20T10:00:00Z");
    const extended = applyPlan(first, findPlan("day")!, BASE, later);
    expect(extended.startsAt).toBe(first.startsAt);
    expect(extended.endsAt).toBe("2026-10-24T10:00:00.000Z");
    expect(extended.paidRub).toBe(34);
    expect(extended.orders.length).toBe(2);
    const afterEnd = new Date("2026-11-01T00:00:00Z");
    const again = applyPlan(extended, findPlan("day")!, BASE, afterEnd);
    expect(again.startsAt).toBe(afterEnd.toISOString());
    expect(isActive(again, afterEnd)).toBe(true);
    expect(isActive(first, afterEnd)).toBe(false);
  });

  it("разбор записи из базы", () => {
    const p = applyPlan(null, findPlan("day")!, BASE, NOW);
    const back = parsePromotion(JSON.stringify(p));
    expect(back?.endsAt).toBe(p.endsAt);
    expect(back?.paidRub).toBe(5);
    expect(back?.sandbox).toBe(true);
    expect(parsePromotion("{")).toBeNull();
    expect(parsePromotion(JSON.stringify({ ...p, kind: "banner" }))).toBeNull();
    expect(parsePromotion(JSON.stringify({ ...p, endsAt: "вчера" }))).toBeNull();
    expect(parsePromotion(null)).toBeNull();
  });

  it("ротация без повторов и сколько осталось", () => {
    const picked = pickForRail([1, 2, 3, 4, 5, 6], 4, () => 0.5);
    expect(picked.length).toBe(4);
    expect(new Set(picked).size).toBe(4);
    expect(pickForRail([1, 2], 4).length).toBe(2);
    expect(timeLeft({ endsAt: "2026-10-19T11:00:00Z" }, NOW)).toBe("ещё 3 дня");
    expect(timeLeft({ endsAt: "2026-10-16T15:00:00Z" }, NOW)).toBe("ещё 5 часов");
    expect(timeLeft({ endsAt: "2026-10-17T11:00:00Z" }, NOW)).toBe("ещё 1 день");
    expect(timeLeft({ endsAt: "2026-10-15T00:00:00Z" }, NOW)).toBe("закончилось");
  });
});
