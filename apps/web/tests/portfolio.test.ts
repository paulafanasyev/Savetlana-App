import { describe, expect, it } from "vitest";
import { addItem, cleanItem, cleanSkills, EMPTY_PORTFOLIO, isEmptyPortfolio, isPortfolioImageUrl, ITEMS_MAX, parsePortfolio, removeItem } from "../src/lib/portfolio";

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
});
