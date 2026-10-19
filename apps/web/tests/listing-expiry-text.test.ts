import { describe, expect, it } from "vitest";
import { listingExpiryText, listingExpiryUrl } from "../src/lib/listing-expiry-text";

const DAY = 86_400_000;
const now = new Date("2026-10-17T03:00:00Z");

describe("напоминание о сроке объявления", () => {
  it("говорит, когда объявление пропадёт из поиска", () => {
    expect(listingExpiryText("Диван", new Date(now.getTime() + 3 * DAY), now).body.includes("через 3 дн.")).toBe(true);
    expect(listingExpiryText("Диван", new Date(now.getTime() + 1.5 * DAY), now).body.includes("завтра")).toBe(true);
    expect(listingExpiryText("Диван", new Date(now.getTime() + 5 * 3600_000), now).body.includes("сегодня")).toBe(true);
  });
  it("заголовок с названием и адрес с объявлением", () => {
    expect(listingExpiryText("  Диван  ", new Date(now.getTime() + DAY), now).title.includes("«Диван»")).toBe(true);
    expect(listingExpiryUrl("abc")).toBe("/classifieds/my?ad=abc");
  });
});
