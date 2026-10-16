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
