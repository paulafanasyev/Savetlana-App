/** Сколько похожих объявлений показываем под объявлением. */
export const SIMILAR_LIMIT = 6;

/**
 * Сначала объявления из того же города, потом из региона; само объявление и повторы
 * не показываем.
 */
export function pickSimilar<T extends { id: string }>(primary: T[], fallback: T[], selfId: string, limit = SIMILAR_LIMIT): T[] {
  const seen = new Set<string>([selfId]);
  const out: T[] = [];
  for (const item of [...primary, ...fallback]) {
    if (out.length >= limit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
