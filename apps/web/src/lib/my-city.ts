/**
 * «Мой город»: хранится в куке на год, без входа на сайт. Из неё берут
 * виджет погоды в шапке, карта выбора города и форма объявления.
 */

export const CITY_COOKIE = "aiko_city";
export const CITY_EVENT = "aiko-city-change";
const MAX_AGE = 60 * 60 * 24 * 365;

/** Название города из строки document.cookie (или заголовка Cookie). */
export function readCityCookie(cookie: string | null | undefined): string | null {
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CITY_COOKIE) continue;
    try {
      const value = decodeURIComponent(part.slice(eq + 1).trim()).trim();
      return value && value.length <= 80 ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Строка для document.cookie. */
export function cityCookieString(name: string): string {
  return `${CITY_COOKIE}=${encodeURIComponent(name.trim().slice(0, 80))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}
