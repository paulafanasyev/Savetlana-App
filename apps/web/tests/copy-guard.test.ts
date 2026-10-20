import { describe, expect, it } from "vitest";
import { isSiteRipper, robotsTagFor } from "../src/lib/copy-guard";

describe("защита от копирования сайта", () => {
  it("программы-зеркала блокируются", () => {
    for (const ua of [
      "Mozilla/4.5 (compatible; HTTrack 3.0x; Windows 98)",
      "Teleport Pro/1.29",
      "Offline Explorer/8.4",
      "Wget/1.21.4",
      "Scrapy/2.11.0 (+https://scrapy.org)",
      "SiteSucker/3.2",
    ]) {
      expect(isSiteRipper(ua)).toBe(true);
    }
  });

  it("браузеры, поисковики, превью и проверки не затронуты", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "TelegramBot (like TwitterBot)",
      "curl/8.5.0",
    ]) {
      expect(isSiteRipper(ua)).toBe(false);
    }
    expect(isSiteRipper(null)).toBe(false);
    expect(isSiteRipper("")).toBe(false);
  });

  it("материалы чек-поинта не индексируются, остальные страницы без копий и ИИ", () => {
    expect(robotsTagFor("/checkpoint/aiko-book.html")).toContain("noindex");
    expect(robotsTagFor("/catalog")).not.toContain("noindex");
    expect(robotsTagFor("/catalog")).toContain("noarchive");
    expect(robotsTagFor("/")).toContain("noai");
  });
});
