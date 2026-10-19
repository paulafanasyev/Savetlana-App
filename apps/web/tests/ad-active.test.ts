import { describe, expect, it } from "vitest";
import { activeAdClause, isAdActive } from "../src/lib/ad-active";

describe("срок объявления", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  it("без срока и с будущим сроком действует, с прошедшим нет", () => {
    expect(isAdActive(null, now)).toBe(true);
    expect(isAdActive(new Date("2026-10-18T00:00:00Z"), now)).toBe(true);
    expect(isAdActive(new Date("2026-10-01T00:00:00Z"), now)).toBe(false);
  });
  it("условие для базы", () => {
    const c = activeAdClause(now);
    expect(c.OR.length).toBe(2);
    expect(c.OR[0].expiresAt).toBe(null);
  });
});
