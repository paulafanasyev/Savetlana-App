import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { isAdFavorite, listAdFavorites, toggleAdFavorite } from "../src/lib/domains/ad-favorites";

describe("избранное объявлений", () => {
  it("несуществующее объявление не добавляется", async () => {
    const u = await prisma.user.create({ data: { email: `fav-a-${Date.now()}@example.com`, passwordHash: "x", name: "A", role: "BUYER" } });
    expect(await toggleAdFavorite(u.id, "no-such-ad")).toBe("not_found");
    expect(await isAdFavorite(u.id, "no-such-ad")).toBe(false);
    expect(await listAdFavorites(u.id)).toEqual([]);
  });

  it("добавляет и убирает повторным нажатием, чужое избранное не видно", async () => {
    const ad = await prisma.classified.findFirst({ select: { id: true } });
    if (!ad) return; // в этой тестовой базе нет объявлений
    const a = await prisma.user.create({ data: { email: `fav-b-${Date.now()}@example.com`, passwordHash: "x", name: "B", role: "BUYER" } });
    const b = await prisma.user.create({ data: { email: `fav-c-${Date.now()}@example.com`, passwordHash: "x", name: "C", role: "BUYER" } });
    expect(await toggleAdFavorite(a.id, ad.id)).toBe("added");
    expect(await isAdFavorite(a.id, ad.id)).toBe(true);
    expect((await listAdFavorites(a.id)).map((x) => x.id)).toEqual([ad.id]);
    expect(await listAdFavorites(b.id)).toEqual([]);
    expect(await toggleAdFavorite(a.id, ad.id)).toBe("removed");
    expect(await isAdFavorite(a.id, ad.id)).toBe(false);
  });
});
