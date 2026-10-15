/**
 * Много карточек сразу: продавец вставляет список, по товару на строку
 * («Кружка керамическая 350 мл, белая, 450 ₽»), Светлана раскладывает каждую
 * строку по полям теми же правилами, что и одиночную карточку
 * (product-compose.ts), и после проверки продавцом создаёт черновики.
 *
 * Для списка работают только правила, без модели: быстро и одинаково для
 * всех строк, ничего не выдумывается. Каждую карточку продавец потом
 * проверяет и публикует сам.
 */
import { parseProductText, type CategoryOption, type ProductComposition } from "./product-compose";

export const BULK_MAX_LINES = 50;

/** Строки списка без нумерации и маркеров. Пустые и слишком короткие отбрасываются. */
export function splitProductLines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d{1,3}[.)]|[-–—•*])\s*/, "").trim())
    .filter((l) => l.length >= 5)
    .slice(0, BULK_MAX_LINES);
}

export function composeMany(text: string, categories: CategoryOption[]): ProductComposition[] {
  return splitProductLines(text).map((line) => parseProductText(line, categories));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Карточка, пришедшая из браузера после проверки продавцом: проверяем заново,
 * ничего не принимаем на веру. null, если карточку создать нельзя.
 */
export function sanitizeComposition(raw: unknown, categorySlugs: Set<string>): ProductComposition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title, 200);
  if (title.length < 3) return null;
  const description = str(o.description, 4000) || title;
  const price = typeof o.priceRub === "number" && Number.isFinite(o.priceRub) && o.priceRub >= 1 && o.priceRub <= 100_000_000 ? Math.round(o.priceRub * 100) / 100 : undefined;
  const slug = str(o.categorySlug, 100);
  const keywords = Array.isArray(o.keywords) ? o.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 15) : [];
  const attributes: Record<string, string> = {};
  if (o.attributes && typeof o.attributes === "object" && !Array.isArray(o.attributes)) {
    for (const [k, v] of Object.entries(o.attributes as Record<string, unknown>).slice(0, 15)) {
      const key = str(k, 40);
      const value = str(v, 100);
      if (key && value) attributes[key] = value;
    }
  }
  return { title, description, priceRub: price, categorySlug: categorySlugs.has(slug) ? slug : "", keywords, attributes };
}

/** Одинаковые названия считаем одним товаром (без регистра и лишних пробелов). */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}
