/**
 * Чистые правила редактирования объявления автором.
 * Менять можно заголовок, описание, цену и характеристики. Раздел, тип сделки, город и
 * фото не меняются: иначе старое объявление с откликами можно было бы превратить в
 * совсем другое.
 */
import { fieldsFor } from "./classified-fields";

export function canEdit(status: string): boolean {
  return status === "PUBLISHED" || status === "MODERATION";
}

/** Цена из формы в рублях: пусто значит «не указана» (0), мусор и отрицательные числа не принимаем. */
export function priceFromRub(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) return null;
  return Math.round(n * 100);
}

/**
 * Характеристики после правки: поля формы целиком берутся из новой формы (стёртое
 * поле исчезает), служебные записи, которых нет в форме, сохраняются.
 */
export function mergeAttrs(
  vertical: string,
  old: Record<string, unknown>,
  parsed: Record<string, string | number>,
): Record<string, unknown> {
  const formKeys = new Set(fieldsFor(vertical).map((f) => f.key));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(old)) if (!formKeys.has(k)) out[k] = v;
  return { ...out, ...parsed };
}
