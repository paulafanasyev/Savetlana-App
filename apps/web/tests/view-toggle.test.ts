import { describe, expect, it } from "vitest";
import { DESKTOP_WIDTH, isDesktopView, parseViewPref, safeBack, viewportFor } from "../src/lib/viewport";

const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 Telegram-Android/11.2";
const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";

describe("кнопка «Полная версия»", () => {
  it("выбор человека важнее User-Agent", () => {
    expect(viewportFor(PHONE, "desktop")).toEqual({ width: DESKTOP_WIDTH });
    expect(viewportFor(PC, "mobile")).toEqual({ width: "device-width", initialScale: 1 });
  });
  it("без выбора всё как раньше", () => {
    expect(isDesktopView(PHONE)).toBe(false);
    expect(isDesktopView(PC)).toBe(true);
    expect(viewportFor(PHONE)).toEqual({ width: "device-width", initialScale: 1 });
  });
  it("мусор в cookie не считается выбором", () => {
    expect(parseViewPref("desktop")).toBe("desktop");
    expect(parseViewPref("mobile")).toBe("mobile");
    expect(parseViewPref("auto")).toBe(null);
    expect(parseViewPref(undefined)).toBe(null);
  });
  it("возврат только на свой сайт", () => {
    expect(safeBack("/catalog?city=Казань")).toBe("/catalog?city=Казань");
    expect(safeBack("https://evil.example")).toBe("/");
    expect(safeBack("//evil.example")).toBe("/");
    expect(safeBack("/\\evil.example")).toBe("/");
    expect(safeBack("/a\r\nSet-Cookie: x")).toBe("/");
    expect(safeBack(null)).toBe("/");
  });
});
