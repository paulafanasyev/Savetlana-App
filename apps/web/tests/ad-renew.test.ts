import { describe, expect, it } from "vitest";
import { canRenew, expiryLabel, renewedUntil } from "../src/lib/ad-active";

const DAY = 86_400_000;
const now = new Date("2026-10-17T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("продление объявления", () => {
  it("продлить можно за 3 дня до конца и после, раньше и без срока нельзя", () => {
    expect(canRenew(at(-5), now)).toBe(true);
    expect(canRenew(at(2), now)).toBe(true);
    expect(canRenew(at(3), now)).toBe(true);
    expect(canRenew(at(10), now)).toBe(false);
    expect(canRenew(null, now)).toBe(false);
  });
  it("новый срок от сегодня или от текущего", () => {
    expect(renewedUntil(at(-5), now).getTime() === at(30).getTime()).toBe(true);
    expect(renewedUntil(at(2), now).getTime() === at(32).getTime()).toBe(true);
  });
  it("подпись срока", () => {
    expect(expiryLabel(at(-1), now)).toBe("срок истёк");
    expect(expiryLabel(at(0.5), now)).toBe("истекает сегодня");
    expect(expiryLabel(at(5), now)).toBe("ещё 5 дн.");
    expect(expiryLabel(null, now)).toBe("");
  });
});
