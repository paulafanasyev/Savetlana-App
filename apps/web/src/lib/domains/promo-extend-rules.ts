/**
 * Продление скидки: чистые правила без базы.
 *
 * Продлеваем от текущей даты окончания (или от «сейчас», если она уже
 * прошла). Вся акция не может идти дольше PROMO_MAX_DAYS дней с запуска:
 * долгая «скидка» перестаёт быть честной, а зачёркнутая цена становится
 * просто второй ценой. Скидку без срока продлевать не нужно.
 */
import { PROMO_MAX_DAYS } from "./engagement-rules";

const DAY_MS = 86_400_000;

export type ExtendResult =
  | { ok: true; endsAt: Date }
  | { ok: false; reason: "no_end" | "bad_days" | "max" };

export function extendedEnd(input: { startedAt: Date; endsAt: Date | null; days: unknown; now?: Date }): ExtendResult {
  const now = input.now ?? new Date();
  if (!input.endsAt) return { ok: false, reason: "no_end" };
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > PROMO_MAX_DAYS) return { ok: false, reason: "bad_days" };
  const base = Math.max(input.endsAt.getTime(), now.getTime());
  const cap = input.startedAt.getTime() + PROMO_MAX_DAYS * DAY_MS;
  const next = Math.min(base + days * DAY_MS, cap);
  // Меньше часа прибавки: считаем, что продлевать уже некуда.
  if (next - input.endsAt.getTime() < 3_600_000) return { ok: false, reason: "max" };
  return { ok: true, endsAt: new Date(next) };
}

/** Почему продлить не получилось: текст для продавца. */
export function extendReasonText(reason: "no_end" | "bad_days" | "max"): string {
  if (reason === "no_end") return "У этой скидки нет срока, она и так идёт, пока вы её не завершите";
  if (reason === "bad_days") return `Продлить можно на 1–${PROMO_MAX_DAYS} дней`;
  return `Скидка уже идёт максимальный срок: ${PROMO_MAX_DAYS} дней с запуска`;
}
