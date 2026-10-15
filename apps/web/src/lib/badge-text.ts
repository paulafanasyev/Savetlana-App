/**
 * Счётчики в меню кабинета продавца: сколько заказов ждут действия
 * и сколько сообщений покупателей не прочитано.
 */

/** Заказы, по которым продавец должен что-то сделать сам. */
export const ORDER_ACTION_STATUSES = ["PAID", "RETURN_REQUESTED", "RETURNING"] as const;

/** Текст на значке: пусто, если ничего нет, и «99+» для больших чисел. */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Подпись для экранного диктора, чтобы значок не читался как просто число. */
export function badgeLabel(kind: "orders" | "messages", count: number): string {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return "";
  const m10 = n % 10;
  const m100 = n % 100;
  const one = m10 === 1 && m100 !== 11;
  const few = m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14);
  if (kind === "orders") return `${n} ${one ? "заказ ждёт" : few ? "заказа ждут" : "заказов ждут"} действия`;
  return `${n} ${one ? "непрочитанное сообщение" : few ? "непрочитанных сообщения" : "непрочитанных сообщений"}`;
}
