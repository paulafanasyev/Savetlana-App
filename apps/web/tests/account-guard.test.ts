import { describe, expect, it } from "vitest";
import { UNKNOWN_DEVICE, deviceLabel, holdMessage, isNewDevice, payoutHold } from "../src/lib/domains/account-guard";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const YANDEX_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Mobile Safari/537.36";

describe("устройство входа", () => {
  it("понятное название по User-Agent", () => {
    expect(deviceLabel(CHROME_WIN)).toBe("Chrome · Windows");
    expect(deviceLabel(SAFARI_IOS)).toBe("Safari · iOS");
    expect(deviceLabel(YANDEX_ANDROID)).toBe("Яндекс Браузер · Android");
    expect(deviceLabel("")).toBe(UNKNOWN_DEVICE);
  });

  it("новое устройство только если есть с чем сравнить", () => {
    expect(isNewDevice("Safari · iOS", ["Chrome · Windows"])).toBe(true);
    expect(isNewDevice("Chrome · Windows", ["Chrome · Windows", "Safari · iOS"])).toBe(false);
    expect(isNewDevice("Chrome · Windows", [])).toBe(false);
    expect(isNewDevice("Chrome · Windows", [UNKNOWN_DEVICE])).toBe(false);
    expect(isNewDevice(UNKNOWN_DEVICE, ["Chrome · Windows"])).toBe(false);
  });
});

describe("пауза выплат", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  it("после смены реквизитов 48 часов", () => {
    const hold = payoutHold({ bankChangedAt: hoursAgo(10), now });
    expect(hold?.until.toISOString()).toBe("2026-10-16T02:00:00.000Z");
    expect(payoutHold({ bankChangedAt: hoursAgo(49), now })).toBeNull();
  });

  it("после сброса пароля 24 часа, берётся самая поздняя пауза", () => {
    expect(payoutHold({ passwordResetAt: hoursAgo(1), now })?.reason).toBe("Пароль недавно сброшен");
    const both = payoutHold({ passwordResetAt: hoursAgo(1), bankChangedAt: hoursAgo(40), now });
    expect(both?.until.toISOString()).toBe("2026-10-15T11:00:00.000Z");
    expect(payoutHold({ now })).toBeNull();
  });

  it("сообщение объясняет причину и срок", () => {
    const hold = payoutHold({ bankChangedAt: hoursAgo(10), now });
    expect(holdMessage(hold!)).toMatch(/Реквизиты для выплат недавно изменены.*МСК/);
  });
});
