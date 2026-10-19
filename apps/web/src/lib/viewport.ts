/**
 * Ширина страницы для браузера.
 *
 * Когда на телефоне включают «Полная версия» (Chrome «Версия для ПК», Safari
 * «Запросить настольный веб-сайт»), браузер меняет только User-Agent на компьютерный, а
 * страница с width=device-width всё равно верстается под узкий экран. Поэтому
 * компьютерному User-Agent отдаём фиксированную ширину 1280: телефон покажет
 * полную версию в уменьшенном виде, а настоящие компьютеры эту настройку не читают.
 */
export const DESKTOP_WIDTH = 1280;

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

export function viewportFor(userAgent: string | null | undefined): { width: string | number; initialScale?: number } {
  return wantsDeviceWidth(userAgent) ? { width: "device-width", initialScale: 1 } : { width: DESKTOP_WIDTH };
}
