import { describe, expect, it } from "vitest";
import { backPath, canClose, canReopen } from "../src/lib/ad-status-rules";

describe("снять и вернуть объявление", () => {
  it("снять можно опубликованное и ждущее проверки", () => {
    expect(canClose("PUBLISHED")).toBe(true);
    expect(canClose("MODERATION")).toBe(true);
    expect(canClose("REJECTED")).toBe(false);
    expect(canClose("CLOSED")).toBe(false);
  });
  it("вернуть можно только снятое автором", () => {
    expect(canReopen("CLOSED")).toBe(true);
    expect(canReopen("SOLD")).toBe(true);
    expect(canReopen("REJECTED")).toBe(false);
    expect(canReopen("HIDDEN")).toBe(false);
    expect(canReopen("PUBLISHED")).toBe(false);
  });
  it("возврат только на свои страницы", () => {
    expect(backPath("abc", "ad")).toBe("/classifieds/abc");
    expect(backPath("abc", null)).toBe("/classifieds/my");
    expect(backPath("abc", "https://evil.example")).toBe("/classifieds/my");
  });
});
