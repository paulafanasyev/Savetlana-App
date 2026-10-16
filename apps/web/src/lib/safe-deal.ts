/**
 * Безопасная сделка: деньги покупателя лежат на счёте площадки, пока товар не
 * получен и не принят. Продавцу они становятся доступны к выплате только когда
 * заказ завершён: покупатель нажал «Товар получен, всё в порядке» или
 * прошло ACCEPT_DAYS дней после доставки, а он не открыл возврат или спор.
 * Пока идёт возврат или спор, деньги никуда не уходят. Чистые правила без
 * базы, чтобы их можно было проверить тестами и показать на странице заказа.
 */

/** Сколько дней после доставки у покупателя есть на проверку товара. */
export const ACCEPT_DAYS = 7;
const DAY_MS = 86_400_000;

/** Только завершённый заказ даёт продавцу деньги к выплате. */
export const PAYOUT_READY_ORDER_STATUSES = ["COMPLETED"] as const;

/** Оплачен, но ещё не завершён: деньги у площадки. */
export const HELD_ORDER_STATUSES = [
  "PAID", "CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED",
  "RETURN_REQUESTED", "RETURNING", "DISPUTED",
] as const;

export function autoAcceptAt(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + ACCEPT_DAYS * DAY_MS);
}

/** Пора ли завершить доставленный заказ без подтверждения покупателя. */
export function autoAcceptDue(deliveredAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= autoAcceptAt(deliveredAt).getTime();
}

function ruDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Что сейчас с деньгами за заказ: текст для покупателя. null: оплаты не было или сделка закрыта. */
export function safeDealBuyerNote(status: string, deliveredAt?: Date | null): string | null {
  if (status === "DELIVERED") {
    const when = deliveredAt ? ` ${ruDate(autoAcceptAt(deliveredAt))}` : ` через ${ACCEPT_DAYS} дней после доставки`;
    return `Деньги пока у площадки. Проверьте товар: если всё в порядке, нажмите «Товар получен». Если ничего не нажать и не открыть спор, деньги уйдут продавцу автоматически${when}.`;
  }
  if (status === "RETURN_REQUESTED" || status === "RETURNING" || status === "DISPUTED") {
    return "Деньги у площадки и не уйдут продавцу, пока не решится возврат или спор.";
  }
  if ((HELD_ORDER_STATUSES as readonly string[]).includes(status)) {
    return "Безопасная сделка: деньги у площадки. Продавец получит их только после того, как вы получите и примете товар.";
  }
  return null;
}

/** То же для продавца. */
export function safeDealSellerNote(status: string): string | null {
  if (status === "COMPLETED") return "Покупатель принял заказ, деньги доступны к выплате.";
  if (status === "DELIVERED") return `Ждём, пока покупатель примет заказ. Если он не откроет спор, деньги станут доступны через ${ACCEPT_DAYS} дней после доставки.`;
  if (status === "RETURN_REQUESTED" || status === "RETURNING" || status === "DISPUTED") return "Деньги заморожены до решения возврата или спора.";
  if ((HELD_ORDER_STATUSES as readonly string[]).includes(status)) return "Деньги покупателя у площадки. Выплата после того, как покупатель получит и примет заказ.";
  return null;
}

/** Последняя доставка по каждому заказу из журнала статусов. */
export function latestDeliveredAt(rows: { orderId: string; createdAt: Date }[]): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const r of rows) {
    const prev = latest.get(r.orderId);
    if (!prev || r.createdAt.getTime() > prev.getTime()) latest.set(r.orderId, r.createdAt);
  }
  return latest;
}

/**
 * Какие доставленные заказы пора завершить. Заказ без записи о доставке не
 * трогаем: лучше задержать выплату, чем отдать деньги без подтверждения.
 */
export function ordersDueForAutoAccept(orderIds: string[], deliveredRows: { orderId: string; createdAt: Date }[], now: Date = new Date()): string[] {
  const latest = latestDeliveredAt(deliveredRows);
  return orderIds.filter((id) => {
    const at = latest.get(id);
    return Boolean(at && autoAcceptDue(at, now));
  });
}
