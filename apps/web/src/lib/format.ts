/** Client-safe formatting helpers (no server imports). */
export function rub(kopecks: number | null | undefined): string {
  if (kopecks === null || kopecks === undefined) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(kopecks / 100) + " ₽";
}

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
