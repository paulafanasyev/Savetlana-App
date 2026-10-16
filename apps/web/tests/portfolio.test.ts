import { describe, expect, it } from "vitest";
import { addItem, cleanItem, cleanSkills, EMPTY_PORTFOLIO, isEmptyPortfolio, isPortfolioImageUrl, ITEMS_MAX, parsePortfolio, removeItem, orphanedImageKey } from "../src/lib/portfolio";

const U = "user123abc";

describe("портфолио исполнителя", () => {
  it("навыки: без повторов и не больше 15", () => {
    expect(cleanSkills("дизайн, вёрстка; Figma, Дизайн")).toEqual(["дизайн", "вёрстка", "Figma"]);
    expect(cleanSkills(Array.from({ length: 30 }, (_, i) => `навык ${i}`))).toHaveLength(15);
    expect(cleanSkills(42)).toEqual([]);
  });

  it("фото только из своей папки на площадке", () => {
    expect(isPortfolioImageUrl(`/api/storage/database/public/portfolio/${U}/1-ab-photo.jpg`, U)).toBe(true);
    expect(isPortfolioImageUrl(`https://abc123.public.blob.vercel-storage.com/public/portfolio/${U}/x.jpg`, U)).toBe(true);
    expect(isPortfolioImageUrl(`/api/storage/database/public/portfolio/other/x.jpg`, U)).toBe(false);
    expect(isPortfolioImageUrl("https://evil.example/x.jpg", U)).toBe(false);
    expect(isPortfolioImageUrl(`/api/storage/public/portfolio/${U}/../x.jpg`, U)).toBe(false);
  });

  it("работа: название и фото или описание", () => {
    expect(cleanItem({ title: "ок" }, U).ok).toBe(false);
    expect(cleanItem({ title: "Лендинг для кофейни" }, U).ok).toBe(false);
    expect(cleanItem({ title: "Лендинг для кофейни", description: "Дизайн и вёрстка за 5 дней" }, U).ok).toBe(true);
    expect(cleanItem({ title: "Лендинг", imageUrl: "https://evil.example/a.jpg" }, U).ok).toBe(false);
  });

  it("список работ: добавить, убрать, лимит", () => {
    let p = { ...EMPTY_PORTFOLIO, items: [] as typeof EMPTY_PORTFOLIO.items };
    expect(isEmptyPortfolio(p)).toBe(true);
    const r = addItem(p, { title: "Логотип", description: "Для пекарни", imageUrl: null }, "abc123");
    expect(r.ok).toBe(true);
    if (r.ok) p = r.portfolio;
    expect(p.items[0].id).toBe("abc123");
    expect(removeItem(p, "abc123").items).toHaveLength(0);
    const full = { ...p, items: Array.from({ length: ITEMS_MAX }, (_, i) => ({ ...p.items[0], id: `item${i}aa` })) };
    expect(addItem(full, { title: "Ещё", description: "одна", imageUrl: null }, "zzz999").ok).toBe(false);
  });

  it("битые данные не ломают страницу", () => {
    expect(parsePortfolio("не json", U)).toEqual({ about: "", skills: [], items: [] });
    const saved = JSON.stringify({ about: "Дизайнер", skills: ["Figma"], items: [{ id: "abc123", title: "Сайт", description: "Готовый сайт", imageUrl: "https://evil.example/a.jpg" }, { id: "def456", title: "Логотип", description: "Для пекарни", createdAt: "2026-10-01T00:00:00.000Z" }] });
    const p = parsePortfolio(saved, U);
    expect(p.items.map((i) => i.id)).toEqual(["def456"]);
    expect(p.skills).toEqual(["Figma"]);
  });

  it("фото удаляется вместе с работой, только если больше нигде не используется", () => {
    const u = "u_abc123";
    const url = `/api/storage/database/public/portfolio/${u}/abc123`;
    const item = { id: "aaaaaa", title: "Работа", description: "", imageUrl: url, createdAt: "" };
    const empty = { about: "", skills: [], items: [] };
    expect(orphanedImageKey(item, empty, u)).toBe(`database/public/portfolio/${u}/abc123`);
    expect(orphanedImageKey(item, { ...empty, items: [{ ...item, id: "bbbbbb" }] }, u)).toBeNull();
    expect(orphanedImageKey({ ...item, imageUrl: "/api/storage/database/public/portfolio/other1/abc" }, empty, u)).toBeNull();
    expect(orphanedImageKey(undefined, empty, u)).toBeNull();
    const blob = `https://abc.public.blob.vercel-storage.com/public/portfolio/${u}/x-1.jpg`;
    expect(orphanedImageKey({ ...item, imageUrl: blob }, empty, u)).toBe(blob);
  });

  it("дефисы в навыках и описаниях сохраняются, управляющие символы убираются", () => {
    expect(cleanSkills("UI-дизайн, веб-вёрстка")).toEqual(["UI-дизайн", "веб-вёрстка"]);
    const c = cleanItem({ title: "Ремонт квартир-студий", description: "Санузел под ключ - 5 дней\x07" }, "u_abc123");
    expect(c.ok && c.item.title).toBe("Ремонт квартир-студий");
    expect(c.ok && c.item.description).toBe("Санузел под ключ - 5 дней");
  });
});
