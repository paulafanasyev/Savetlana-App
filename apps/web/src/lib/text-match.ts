/**
 * Поиск по тексту без учёта регистра.
 *
 * В PostgreSQL `contains` различает большие и маленькие буквы: «kia» не находил
 * «Kia Rio». `mode: "insensitive"` есть только у PostgreSQL, а тесты работают на SQLite,
 * поэтому ищем по нескольким написаниям запроса: как ввели, строчными, с большой
 * буквы, каждое слово с большой буквы и заглавными. Это покрывает обычные
 * заголовки объявлений («Kia Rio», «BMW», «Москва»).
 */

const WORD_START = /(^|[\s\-«"(/])(\p{L})/gu;

export function caseVariants(query: string): string[] {
  const t = query.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const lower = t.toLowerCase();
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  const title = lower.replace(WORD_START, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  return [...new Set([t, lower, cap, title, t.toUpperCase()])];
}

/** Условие OR для Prisma: любое из полей содержит любое из написаний запроса. */
export function textMatchOr<F extends string>(query: string, fields: readonly F[]): Array<{ [K in F]?: { contains: string } }> {
  const out: Array<{ [K in F]?: { contains: string } }> = [];
  for (const v of caseVariants(query)) {
    for (const f of fields) out.push({ [f]: { contains: v } } as { [K in F]?: { contains: string } });
  }
  return out;
}
