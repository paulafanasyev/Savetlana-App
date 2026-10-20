/**
 * Защита от копирования сайта (используется в middleware).
 *
 * - Программы, которые целиком скачивают сайт для офлайн-копии (HTTrack,
 *   Teleport, Offline Explorer, wget-зеркало, Scrapy…), получают 403.
 *   Обычные браузеры, поисковики, превью ссылок и мониторинг не затронуты.
 * - Поисковикам запрещено хранить копии страниц, ИИ-сервисам — учиться на них;
 *   материалы чек-поинта ещё и не индексируются.
 */

const SITE_RIPPERS =
  /(httrack|webcopier|offline explorer|sitesucker|teleport ?pro|webzip|webstripper|webreaper|webwhacker|blackwidow|website quester|website extractor|sitesnagger|grab-site|scrapy|wget)/i;

/** Это программа для скачивания сайта целиком? */
export function isSiteRipper(userAgent: string | null | undefined): boolean {
  return !!userAgent && SITE_RIPPERS.test(userAgent);
}

/** Значение X-Robots-Tag для страницы. */
export function robotsTagFor(pathname: string): string {
  return pathname.startsWith("/checkpoint/")
    ? "noindex, noarchive, noai, noimageai"
    : "noarchive, noai, noimageai";
}
