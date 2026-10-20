/**
 * Кто попадает в выдачу по запросу.
 *
 * Раньше поиск возвращал весь каталог, просто отсортированный: на «нож» приходили
 * кроссовки и смартфоны. Теперь товар остаётся, если совпало слово запроса
 * (с учётом окончаний) или он заметно близок по смыслу. Если не нашлось ничего,
 * показываем несколько самых близких по смыслу (спасает при опечатках).
 */

/** Близость по смыслу, при которой товар показываем и без совпадения слов. */
export const SEM_STRONG = 0.3;
/** Нижняя граница для запасной выдачи, когда слова не совпали ни с чем. */
export const SEM_FALLBACK = 0.25;
export const FALLBACK_MAX = 6;

/** Отрезаем окончание длинного слова: «кроссовки» находит «кроссовок», «перчатки» находит «перчаток». */
export function stemTerm(term: string): string {
  return term.length > 5 ? term.slice(0, term.length - 2) : term;
}

/** Слова запроса в нижнем регистре, без знаков препинания и коротких предлогов, с отрезанными окончаниями. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length > 2) seen.add(stemTerm(raw));
  }
  return [...seen];
}

/** Текст товара для сравнения со словами запроса. */
export function normalizeHay(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

export interface RelevanceRow {
  id: string;
  /** Очки за совпадение слов. */
  kw: number;
  /** Близость по смыслу, 0..1. */
  sem: number;
}

/** Какие товары оставить в выдаче. */
export function relevantIds(rows: RelevanceRow[]): { ids: Set<string>; fallback: boolean } {
  const ids = new Set(rows.filter((r) => r.kw > 0 || r.sem >= SEM_STRONG).map((r) => r.id));
  if (ids.size > 0) return { ids, fallback: false };
  const near = rows
    .filter((r) => r.sem >= SEM_FALLBACK)
    .sort((a, b) => b.sem - a.sem)
    .slice(0, FALLBACK_MAX);
  return { ids: new Set(near.map((r) => r.id)), fallback: near.length > 0 };
}
