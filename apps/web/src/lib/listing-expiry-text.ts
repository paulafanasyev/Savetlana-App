/**
 * Текст напоминания «срок объявления заканчивается». Честно и без искусственной
 * срочности: что случится и что можно сделать.
 */
const DAY = 86_400_000;

/** Адрес уведомления: один на объявление, по нему же не шлём повторно. */
export function listingExpiryUrl(classifiedId: string): string {
  return `/classifieds/my?ad=${encodeURIComponent(classifiedId)}`;
}

export function listingExpiryText(title: string, expiresAt: Date, now: Date = new Date()): { title: string; body: string } {
  const name = title.trim().slice(0, 80);
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
  const when = days <= 1 ? "сегодня" : days === 2 ? "завтра" : `через ${days} дн.`;
  return {
    title: `Срок объявления «${name}» заканчивается`,
    body: `Объявление пропадёт из поиска ${when}. Если оно ещё актуально, продлите его на 30 дней в «Моих объявлениях», это бесплатно.`,
  };
}
