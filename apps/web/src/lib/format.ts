/** Client-safe formatting helpers (no server imports). */
export function rub(kopecks: number | null | undefined): string {
  if (kopecks === null || kopecks === undefined) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(kopecks / 100) + " ₽";
}

/**
 * Форма слова после числа: plural(1, ["отзыв", "отзыва", "отзывов"]) → «отзыв»,
 * 3 → «отзыва», 5 и 11–14 → «отзывов». Дробные числа дают форму для 2–4.
 */
export function plural(n: number, forms: readonly [string, string, string]): string {
  if (!Number.isInteger(n)) return forms[1];
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Число и слово вместе: countText(21, ["отзыв", "отзыва", "отзывов"]) → «21 отзыв». */
export function countText(n: number, forms: readonly [string, string, string]): string {
  return `${new Intl.NumberFormat("ru-RU").format(n)} ${plural(n, forms)}`;
}

export const REVIEW_FORMS = ["отзыв", "отзыва", "отзывов"] as const;

export function availabilityLabel(status: string | null | undefined): string {
  switch (status) {
    case "AVAILABLE":
      return "В наличии";
    case "LIMITED":
      return "Осталось мало";
    case "OUT_OF_STOCK":
      return "Нет в наличии";
    case "PREORDER":
      return "Предзаказ";
    case "MADE_TO_ORDER":
      return "Под заказ";
    default:
      return "Наличие уточняется";
  }
}

export function orderStatusLabel(status: string): string {
  const map: Record<string, string> = {
    CREATED: "Создан",
    PAYMENT_PENDING: "Ожидает оплаты",
    PAID: "Оплачен",
    CONFIRMED: "Подтверждён продавцом",
    PROCESSING: "Собирается",
    READY: "Готов к выдаче",
    HANDED_TO_CARRIER: "Передан перевозчику",
    IN_TRANSIT: "В пути",
    DELIVERED: "Доставлен",
    COMPLETED: "Завершён",
    CANCELLED: "Отменён",
    RETURN_REQUESTED: "Запрошен возврат",
    RETURNING: "Возврат",
    REFUNDED: "Возврат выполнен",
    DISPUTED: "Спор",
  };
  return map[status] ?? status;
}

export function timeAgo(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
