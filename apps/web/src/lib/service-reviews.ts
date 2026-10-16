/**
 * Отзывы о работе исполнителя. Оставить отзыв может только заказчик и только
 * после того, как сделка завершена (работа принята), один отзыв на заказ.
 * Отзыв хранится как уведомление исполнителю с размеченной первой строкой,
 * поэтому отдельная таблица не нужна. Здесь только чистые правила.
 */

export const REVIEW_MARK = "⭐ Отзыв по заказу";
export const SERVICE_REVIEW_KIND = "service_review";
export const REVIEW_TEXT_MIN = 10;
export const REVIEW_TEXT_MAX = 1000;
/** Отзыв можно оставить только по завершённой сделке. */
export const REVIEWABLE_STATUSES = ["COMPLETED"];

export interface ServiceReview {
  orderNumber: string;
  rating: number;
  text: string;
}

export function cleanServiceReview(input: { rating?: unknown; text?: unknown }): { ok: true; rating: number; text: string } | { ok: false; error: string } {
  const rating = typeof input.rating === "string" ? Number(input.rating) : input.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Поставьте оценку от 1 до 5" };
  const text = typeof input.text === "string" ? input.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (text.length < REVIEW_TEXT_MIN) return { ok: false, error: `Напишите хотя бы ${REVIEW_TEXT_MIN} символов о том, как прошла работа` };
  if (text.length > REVIEW_TEXT_MAX) return { ok: false, error: `Отзыв длиннее ${REVIEW_TEXT_MAX} символов, сократите его` };
  return { ok: true, rating, text };
}

/** Начало текста, по которому ищем отзыв этого заказа (один отзыв на заказ). */
export function reviewPrefix(orderNumber: string): string {
  return `${REVIEW_MARK} ${orderNumber}:`;
}

export function reviewBody(orderNumber: string, rating: number, text: string): string {
  return `${reviewPrefix(orderNumber)} ${rating} из 5\n\n${text}`;
}

const LINE = /^⭐ Отзыв по заказу (\S+): ([1-5]) из 5/;

export function parseReviewBody(body: string): ServiceReview | null {
  const m = LINE.exec(body);
  if (!m) return null;
  return { orderNumber: m[1] as string, rating: Number(m[2]), text: body.slice(m[0].length).trim() };
}

function reviewsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "отзыв";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "отзыва";
  return "отзывов";
}

/** Средняя оценка с одним знаком: 4,7. null, если отзывов нет. */
export function averageRating(ratings: number[]): number | null {
  const ok = ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  if (ok.length === 0) return null;
  return Math.round((ok.reduce((s, r) => s + r, 0) / ok.length) * 10) / 10;
}

/** «Оценка 4,7 из 5 · 3 отзыва» или пусто, если отзывов нет. */
export function ratingText(ratings: number[]): string {
  const avg = averageRating(ratings);
  if (avg === null) return "";
  const n = ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5).length;
  return `Оценка ${String(avg).replace(".", ",")} из 5 · ${n} ${reviewsWord(n)}`;
}

export function stars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(r) + "☆".repeat(5 - r);
}
