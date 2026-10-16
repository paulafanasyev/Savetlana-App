/**
 * Портфолио исполнителя: пара слов о себе, навыки и работы с фото. Хранится
 * одной записью (JSON) рядом с файлами в базе, поэтому миграция не нужна.
 * Здесь только чистые правила: разбор, проверка и правки списка работ.
 */

export const ABOUT_MAX = 1000;
export const SKILLS_MAX = 15;
export const SKILL_MAX_LEN = 40;
export const ITEMS_MAX = 20;
export const ITEM_TITLE_MIN = 3;
export const ITEM_TITLE_MAX = 80;
export const ITEM_TEXT_MAX = 500;
/** Фото работы: не больше 2 МБ (в браузере уменьшается до 1600 px). */
export const PORTFOLIO_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  createdAt: string;
}

export interface Portfolio {
  about: string;
  skills: string[];
  items: PortfolioItem[];
}

export const EMPTY_PORTFOLIO: Portfolio = { about: "", skills: [], items: [] };

/** Папка для фото работ этого исполнителя. */
export const portfolioBucket = (userId: string) => `public/portfolio/${userId}`;

function oneLine(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function text(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/** «дизайн, вёрстка; Figma» → ["дизайн", "вёрстка", "Figma"], без повторов. */
export function cleanSkills(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const s = oneLine(v).slice(0, SKILL_MAX_LEN);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= SKILLS_MAX) break;
  }
  return out;
}

export function cleanAbout(raw: unknown): string {
  return text(raw, ABOUT_MAX);
}

/** Фото принимаем только из папки портфолио этого исполнителя на нашей площадке. */
export function isPortfolioImageUrl(url: unknown, userId: string): url is string {
  if (typeof url !== "string" || url.length > 500 || !/^[A-Za-z0-9_-]+$/.test(userId)) return false;
  const local = new RegExp(`^/api/storage/(database/)?public/portfolio/${userId}/[A-Za-z0-9._%-]+$`);
  const blob = new RegExp(`^https://[a-z0-9]+\\.public\\.blob\\.vercel-storage\\.com/public/portfolio/${userId}/[A-Za-z0-9._%-]+$`);
  return local.test(url) || blob.test(url);
}

export function cleanItem(raw: { title?: unknown; description?: unknown; imageUrl?: unknown }, userId: string): { ok: true; item: Omit<PortfolioItem, "id" | "createdAt"> } | { ok: false; error: string } {
  const title = typeof raw.title === "string" ? oneLine(raw.title).slice(0, ITEM_TITLE_MAX) : "";
  if (title.length < ITEM_TITLE_MIN) return { ok: false, error: `Назовите работу: хотя бы ${ITEM_TITLE_MIN} символа` };
  const description = text(raw.description, ITEM_TEXT_MAX);
  let imageUrl: string | null = null;
  if (raw.imageUrl !== undefined && raw.imageUrl !== null && raw.imageUrl !== "") {
    if (!isPortfolioImageUrl(raw.imageUrl, userId)) return { ok: false, error: "Фото нужно загрузить заново: ссылка не из вашего портфолио" };
    imageUrl = raw.imageUrl;
  }
  if (!description && !imageUrl) return { ok: false, error: "Добавьте фото или пару слов о работе" };
  return { ok: true, item: { title, description, imageUrl } };
}

/** Разбор сохранённого JSON: всё лишнее и битое отбрасывается. */
export function parsePortfolio(json: string | null | undefined, userId: string): Portfolio {
  let v: unknown;
  try {
    v = JSON.parse(json ?? "{}");
  } catch {
    return { ...EMPTY_PORTFOLIO, items: [] };
  }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const items: PortfolioItem[] = [];
  for (const raw of Array.isArray(o.items) ? o.items : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[a-z0-9]{6,32}$/.test(r.id)) continue;
    const c = cleanItem(r, userId);
    if (!c.ok) continue;
    items.push({ ...c.item, id: r.id, createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString() });
    if (items.length >= ITEMS_MAX) break;
  }
  return { about: cleanAbout(o.about), skills: cleanSkills(o.skills), items };
}

export function addItem(p: Portfolio, item: Omit<PortfolioItem, "id" | "createdAt">, id: string, now: Date = new Date()): { ok: true; portfolio: Portfolio } | { ok: false; error: string } {
  if (p.items.length >= ITEMS_MAX) return { ok: false, error: `В портфолио не больше ${ITEMS_MAX} работ. Уберите старую, чтобы добавить новую` };
  return { ok: true, portfolio: { ...p, items: [{ ...item, id, createdAt: now.toISOString() }, ...p.items] } };
}

export function removeItem(p: Portfolio, id: string): Portfolio {
  return { ...p, items: p.items.filter((i) => i.id !== id) };
}

export function isEmptyPortfolio(p: Portfolio): boolean {
  return !p.about && p.skills.length === 0 && p.items.length === 0;
}

/**
 * Ключ файла в хранилище, который можно удалить вместе с работой: только из папки
 * этого исполнителя и только если фото не осталось в других работах.
 */
export function orphanedImageKey(removed: PortfolioItem | undefined, remaining: Portfolio, userId: string): string | null {
  const url = removed?.imageUrl;
  if (!url || !isPortfolioImageUrl(url, userId)) return null;
  if (remaining.items.some((i) => i.imageUrl === url)) return null;
  if (url.startsWith("https://")) return url;
  try {
    return url.slice("/api/storage/".length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}
