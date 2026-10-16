/**
 * Число из параметра ссылки. Нет параметра или он пустой: undefined, а не 0.
 * Раньше Number(null) давал 0, и поиск искал объявления «до 0 ₽».
 */
export function queryNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
