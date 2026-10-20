/**
 * Кто попадает в выдачу по запросу.
 *
 * Раньше поиск возвращал весь каталог, просто отсортированный: на «нож» приходили
 * кроссовки и смартфоны. Теперь товар остаётся, если совпало слово запроса
 * (с учётом окончаний) или он по смыслу не хуже лучшего совпадения.
 *
 * Порог по смыслу относительный: у модели близость сильно гуляет от запроса к запросу
 * (на «кроссовки» дизайн-проект набирал 46%, на «нож» настоящий нож только 32%), поэтому
 * сравниваем с лучшим товаром этого же запроса. Если слова не совпали ни с чем
 * (опечатка), показываем несколько самых близких по смыслу с пометкой.
 */

/** Нижняя граница близости для товара без совпадения слов. */
export const SEM_STRONG = 0.3;
/** Товар без совпадения слов должен набрать не меньше такой доли от лучшего. */
export const SEM_RELATIVE = 0.9;
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
export function relevantIds(rows: RelevanceRow[]): { ids: Set<string> ; fallback: boolean } {
  const matched = rows.filter((r) => r.kw > 0);
  if (matched.length > 0) {
    // Планка по смыслу: не ниже 90% от лучшего товара со совпавшими словами.
    const bar = Math.max(SEM_STRONG, SEM_RELATIVE * Math.max(...matched.map((r) => r.sem)));
    const ids = new Set(rows.filter((r) => r.kw > 0 || r.sem >= bar).map((r) => r.id));
    return { ids, fallback: false };
  }
  const near = rows
    .filter((r) => r.sem >= SEM_FALLBACK)
    .sort((a, b) => b.sem - a.sem)
    .slice(0, FALLBACK_MAX);
  return { ids: new Set(near.map((r) => r.id)), fallback: near.length > 0 };
}
