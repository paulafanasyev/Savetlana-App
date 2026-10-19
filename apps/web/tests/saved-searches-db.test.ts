import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { addSavedSearch, listSavedSearches, removeSavedSearch } from "../src/lib/domains/saved-searches";

describe("сохранённые поиски в базе", () => {
  it("сохраняет, не плодит повторы, удаляет только свои", async () => {
    const a = await prisma.user.create({ data: { email: `ss-a-${Date.now()}@example.com`, passwordHash: "x", name: "A", role: "BUYER" } });
    const b = await prisma.user.create({ data: { email: `ss-b-${Date.now()}@example.com`, passwordHash: "x", name: "B", role: "BUYER" } });
    expect(await addSavedSearch(a.id, { q: "kia" }, "«kia» · вся Россия")).toBe("added");
    expect(await addSavedSearch(a.id, { q: "KIA " }, "повтор")).toBe("exists");
    const list = await listSavedSearches(a.id);
    expect(list).toHaveLength(1);
    expect(list[0].href).toBe("/classifieds?q=kia&cityId=all");
    expect(await listSavedSearches(b.id)).toHaveLength(0);
    // Чужой поиск удалить нельзя.
    expect(await removeSavedSearch(b.id, list[0].id)).toBe(false);
    expect(await removeSavedSearch(a.id, list[0].id)).toBe(true);
    expect(await listSavedSearches(a.id)).toHaveLength(0);
  });

  it("не больше 10 поисков на человека", async () => {
    const u = await prisma.user.create({ data: { email: `ss-c-${Date.now()}@example.com`, passwordHash: "x", name: "C", role: "BUYER" } });
    for (let i = 0; i < 10; i++) expect(await addSavedSearch(u.id, { q: `запрос ${i}` }, `запрос ${i}`)).toBe("added");
    expect(await addSavedSearch(u.id, { q: "лишний" }, "лишний")).toBe("limit");
  });
});
