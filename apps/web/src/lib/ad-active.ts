/**
 * Объявление действует, пока не истёк срок (30 дней с публикации). Без срока действует
 * всегда. Одно правило для поиска, блока «Рядом», фриланса и карты сайта.
 * Условие кладётся в AND, чтобы не перетереть OR поиска по тексту.
 */
export function activeAdClause(now: Date = new Date()) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/** То же правило для одного объявления в памяти. */
export function isAdActive(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

const DAY = 86_400_000;
/** На сколько дней продлевается объявление. */
export const RENEW_DAYS = 30;
/** Продлить можно за столько дней до конца срока или после него. */
export const RENEW_WINDOW_DAYS = 3;

/**
 * Можно ли продлить: срок подходит к концу или уже истёк. Продление не поднимает
 * объявление в списке (дата публикации прежняя), только возвращает его в поиск.
 */
export function canRenew(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - now.getTime() <= RENEW_WINDOW_DAYS * DAY;
}

/** Новый срок: 30 дней от сегодня, или от текущего срока, если он ещё не истёк. */
export function renewedUntil(expiresAt: Date | null | undefined, now: Date = new Date()): Date {
  const from = expiresAt && expiresAt.getTime() > now.getTime() ? expiresAt.getTime() : now.getTime();
  return new Date(from + RENEW_DAYS * DAY);
}

/** Срок для автора: «срок истёк», «истекает сегодня», «ещё 5 дн.». Без срока пусто. */
export function expiryLabel(expiresAt: Date | null | undefined, now: Date = new Date()): string {
  if (!expiresAt) return "";
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return "срок истёк";
  const days = Math.ceil(left / DAY);
  return days <= 1 ? "истекает сегодня" : `ещё ${days} дн.`;
}
