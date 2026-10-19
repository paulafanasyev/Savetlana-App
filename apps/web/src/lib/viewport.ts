/**
 * Ширина страницы для браузера.
 *
 * Когда на телефоне включают «Полная версия» (Chrome «Версия для ПК», Safari
 * «Запросить настольный веб-сайт»), браузер меняет только User-Agent на компьютерный, а
 * страница с width=device-width всё равно верстается под узкий экран. Поэтому
 * компьютерному User-Agent отдаём фиксированную ширину 1280: телефон покажет
 * полную версию в уменьшенном виде, а настоящие компьютеры эту настройку не читают.
 *
 * Во встроенном браузере Telegram и части Android-браузеров такого переключателя нет,
 * поэтому есть своя кнопка в подвале: выбор хранится в cookie aiko_view и важнее User-Agent.
 */
export const DESKTOP_WIDTH = 1280;
export const VIEW_COOKIE = "aiko_view";
export type ViewPref = "desktop" | "mobile" | null;

const PHONE_UA = /Mobi|Android|iPhone|iPod|iPad|Opera Mini|IEMobile|webOS|BlackBerry|Windows Phone/i;

/** Мобильный или неизвестный браузер: обычная адаптивная вёрстка. */
export function wantsDeviceWidth(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  // Без User-Agent (боты, проверки) ничего не меняем.
  if (!ua) return true;
  // Автотесты в браузере без экрана проверяют обычную вёрстку.
  if (/HeadlessChrome|Playwright|bot|crawl|spider/i.test(ua)) return true;
  return PHONE_UA.test(ua);
}

/** Значение cookie в выбор пользователя; всё прочее значит «не выбрано». */
export function parseViewPref(value: string | null | undefined): ViewPref {
  return value === "desktop" || value === "mobile" ? value : null;
}

/** Показывать ли широкую версию: сначала выбор человека, потом User-Agent. */
export function isDesktopView(userAgent: string | null | undefined, pref: ViewPref = null): boolean {
  if (pref === "desktop") return true;
  if (pref === "mobile") return false;
  return !wantsDeviceWidth(userAgent);
}

export function viewportFor(
  userAgent: string | null | undefined,
  pref: ViewPref = null,
): { width: string | number; initialScale?: number } {
  return isDesktopView(userAgent, pref) ? { width: DESKTOP_WIDTH } : { width: "device-width", initialScale: 1 };
}

/** Куда вернуть после переключения: только страница этого же сайта. */
export function safeBack(back: string | null | undefined): string {
  const b = (back ?? "").trim();
  if (!b.startsWith("/") || b.startsWith("//") || b.startsWith("/\\") || b.length > 500) return "/";
  if (/[\r\n]/.test(b)) return "/";
  return b;
}
