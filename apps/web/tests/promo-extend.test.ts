import { describe, expect, it } from "vitest";
import { extendReasonText, extendedEnd } from "../src/lib/domains/promo-extend-rules";

const DAY = 86_400_000;
const now = new Date("2026-10-15T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("продление скидки", () => {
  it("прибавляет дни к текущей дате окончания", () => {
    expect(extendedEnd({ startedAt: at(-3), endsAt: at(1), days: 7, now })).toEqual({ ok: true, endsAt: at(8) });
  });

  it("если срок уже прошёл, считает от сейчас", () => {
    expect(extendedEnd({ startedAt: at(-5), endsAt: at(-1), days: 3, now })).toEqual({ ok: true, endsAt: at(3) });
  });

  it("вся акция не дольше 30 дней с запуска", () => {
    expect(extendedEnd({ startedAt: at(-25), endsAt: at(2), days: 7, now })).toEqual({ ok: true, endsAt: at(5) });
    expect(extendedEnd({ startedAt: at(-28), endsAt: at(2), days: 7, now })).toEqual({ ok: false, reason: "max" });
  });

  it("не продлевает скидку без срока и неверный срок", () => {
    expect(extendedEnd({ startedAt: at(-1), endsAt: null, days: 3, now })).toEqual({ ok: false, reason: "no_end" });
    expect(extendedEnd({ startedAt: at(-1), endsAt: at(1), days: 0, now })).toEqual({ ok: false, reason: "bad_days" });
    expect(extendedEnd({ startedAt: at(-1), endsAt: at(1), days: 31, now })).toEqual({ ok: false, reason: "bad_days" });
    expect(extendedEnd({ startedAt: at(-1), endsAt: at(1), days: "abc", now })).toEqual({ ok: false, reason: "bad_days" });
  });

  it("объясняет отказ по-русски", () => {
    expect(extendReasonText("max")).toContain("30 дней");
    expect(extendReasonText("no_end")).toContain("нет срока");
    expect(extendReasonText("bad_days")).toBe("Продлить можно на 1–30 дней");
  });
});
