/**
 * Кто попадает в выдачу по запросу.
 *
 * Раньше поиск возвращал весь каталог, просто отсортированный: на «нож» приходили
 * кроссовки и смартфоны. Теперь товар остаётся, если совпало слово запроса
 * (с учётом окончаний и опечаток) или он по смыслу не хуже лучшего совпадения.
 *
 * Порог по смыслу относительный: у модели близость сильно гуляет от запроса к запросу
 * (на «кроссовки» дизайн-проект набирал 46%, на «нож» настоящий нож только 32%), поэтому
 * сравниваем с лучшим товаром этого же запроса. Если слова не совпали ни с чем,
 * показываем несколько самых близких по смыслу с пометкой.
 *
 * Опечатки: слово запроса, которого нет ни в одном товаре, заменяем ближайшим словом из
 * самого каталога (1 ошибка в слове до 6 букв, 2 в длинном). Покупателю честно
 * пишем, по какому запросу показана выдача.
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

function words(text: string): string[] {
  return text.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
}

/** Слова запроса в нижнем регистре, без знаков препинания и коротких предлогов, с отрезанными окончаниями. */
export function queryTerms(query: string): string[] {
  return [...new Set(words(query).map(stemTerm))];
}

/** Текст товара для сравнения со словами запроса. */
export function normalizeHay(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

/**
 * Расстояние Дамерау-Левенштейна (вставка, удаление, замена, перестановка соседних букв).
 * Больше max не считаем: возвращаем max + 1.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d.push(new Array<number>(b.length + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return Math.min(d[a.length][b.length], max + 1);
}

/** Словарь каталога для исправления опечаток: слова из 4+ букв без цифр. */
export function buildVocabulary(texts: string[]): string[] {
  const vocab = new Set<string>();
  for (const t of texts) for (const w of words(t)) if (w.length >= 4 && !/\d/.test(w)) vocab.add(w);
  return [...vocab];
}

export interface QueryCorrection {
  /** Основы слов для поиска после исправления. */
  terms: string[];
  fixes: { from: string; to: string }[];
  /** Исправленный запрос для показа и поиска по смыслу; null, если исправлять нечего. */
  corrected: string | null;
}

/**
 * Исправляет слова запроса, которых нет в каталоге. hasMatch(основа) говорит, встречается ли
 * слово хоть в одном товаре. Сравниваем и целые слова, и основы: так «кросовок»
 * находит «кроссовки», хотя у них разные окончания.
 */
export function correctQuery(query: string, vocab: string[], hasMatch: (stem: string) => boolean): QueryCorrection {
  const out: string[] = [];
  const fixes: { from: string; to: string }[] = [];
  for (const w of words(query)) {
    if (w.length < 4 || /\d/.test(w) || hasMatch(stemTerm(w))) {
      out.push(w);
      continue;
    }
    const max = w.length >= 7 ? 2 : 1;
    const stem = stemTerm(w);
    let best: string | null = null;
    let bestD = max + 1;
    for (const v of vocab) {
      const dist = Math.min(editDistance(w, v, max), editDistance(stem, stemTerm(v), max));
      if (dist < bestD) {
        bestD = dist;
        best = v;
      }
    }
    if (best && bestD <= max) {
      out.push(best);
      fixes.push({ from: w, to: best });
    } else {
      out.push(w);
    }
  }
  return { terms: [...new Set(out.map(stemTerm))], fixes, corrected: fixes.length > 0 ? out.join(" ") : null };
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
