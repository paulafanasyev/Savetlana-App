/**
 * Сохранённый поиск объявлений: чистые функции (параметры, ссылка, подпись,
 * текст уведомления). Хранение и рассылка в domains/saved-searches.ts.
 */
import { countText } from "./format";

export interface SavedSearchParams {
  vertical?: string;
  dealType?: string;
  cityId?: string;
  q?: string;
}

/** Сколько поисков можно хранить одному человеку. */
export const MAX_SAVED_SEARCHES = 10;

const LIMITS: Record<keyof SavedSearchParams, number> = { vertical: 40, dealType: 40, cityId: 64, q: 100 };

/** Параметры из формы: без пустых, с ограничением длины; cityId=all значит «вся Россия». */
export function cleanParams(raw: Record<string, unknown>): SavedSearchParams {
  const out: SavedSearchParams = {};
  for (const key of Object.keys(LIMITS) as (keyof SavedSearchParams)[]) {
    const v = raw[key];
    if (typeof v !== "string") continue;
    const s = v.replace(/\s+/g, " ").trim().slice(0, LIMITS[key]);
    if (!s) continue;
    if (key === "cityId" && s === "all") continue;
    out[key] = s;
  }
  return out;
}

/** Ключ для поиска повторов: одинаковые параметры дают одинаковый ключ. */
export function paramsKey(p: SavedSearchParams): string {
  const c = cleanParams(p as Record<string, unknown>);
  return JSON.stringify([c.vertical ?? "", c.dealType ?? "", c.cityId ?? "", (c.q ?? "").toLowerCase()]);
}

/** Ссылка на список. Без города явно «вся Россия», иначе подставился бы «мой город». */
export function searchHref(p: SavedSearchParams): string {
  const sp = new URLSearchParams();
  if (p.vertical) sp.set("vertical", p.vertical);
  if (p.dealType) sp.set("dealType", p.dealType);
  if (p.q) sp.set("q", p.q);
  sp.set("cityId", p.cityId || "all");
  return `/classifieds?${sp.toString()}`;
}

/** Подпись для человека: ««kia rio» · Автомобили · Продажа · г. Москва». */
export function searchLabel(
  p: SavedSearchParams,
  names: { vertical?: string | null; dealType?: string | null; city?: string | null } = {},
): string {
  const parts: string[] = [];
  if (p.q) parts.push(`«${p.q}»`);
  if (p.vertical) parts.push(names.vertical || p.vertical);
  if (p.dealType) parts.push(names.dealType || p.dealType);
  parts.push(p.cityId ? (names.city ? `г. ${names.city}` : "выбранный город") : "вся Россия");
  if (parts.length === 1) parts.unshift("Все объявления");
  return parts.join(" · ").slice(0, 200);
}

export const NEW_AD_FORMS: [string, string, string] = ["новое объявление", "новых объявления", "новых объявлений"];

/** Текст уведомления о новых объявлениях по сохранённому поиску. */
export function alertText(count: number, label: string): { title: string; body: string } {
  return {
    title: `${countText(count, NEW_AD_FORMS)} по вашему поиску`,
    body: `${label}. Откройте, чтобы посмотреть. Отключить: «Мои поиски» в объявлениях.`,
  };
}
