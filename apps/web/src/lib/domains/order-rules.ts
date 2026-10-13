/**
 * Что продавец может сделать с заказом в каждом статусе. Чистые правила без
 * базы, чтобы их было легко проверять тестами и показывать нужные кнопки.
 */
export type SellerOrderAction = "reject" | "accept_return" | "decline_return" | "refund_return";

export const SELLER_ORDER_ACTIONS: Record<SellerOrderAction, { from: string; to: string; label: string }> = {
  reject: { from: "PAID", to: "CANCELLED", label: "Отказаться от заказа" },
  accept_return: { from: "RETURN_REQUESTED", to: "RETURNING", label: "Принять возврат" },
  decline_return: { from: "RETURN_REQUESTED", to: "COMPLETED", label: "Отказать в возврате" },
  refund_return: { from: "RETURNING", to: "REFUNDED", label: "Товар вернулся, вернуть деньги" },
};

export const REJECT_REASONS: Record<string, string> = {
  OUT_OF_STOCK: "Товар закончился",
  CANNOT_DELIVER: "Не могу доставить",
  LISTING_ERROR: "Ошибка в цене или описании",
  OTHER: "Другая причина",
};

export function allowedSellerActions(status: string): SellerOrderAction[] {
  return (Object.keys(SELLER_ORDER_ACTIONS) as SellerOrderAction[]).filter((a) => SELLER_ORDER_ACTIONS[a].from === status);
}

export function isSellerOrderAction(value: unknown): value is SellerOrderAction {
  return typeof value === "string" && value in SELLER_ORDER_ACTIONS;
}

/** Причина обязательна, когда продавец отказывает покупателю. */
export function actionReason(action: SellerOrderAction, reason: unknown, comment: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const note = typeof comment === "string" ? comment.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (action === "reject") {
    const key = typeof reason === "string" ? reason : "";
    if (!(key in REJECT_REASONS)) return { ok: false, error: "Выберите причину отказа" };
    if (key === "OTHER" && note.length < 10) return { ok: false, error: "Опишите причину (минимум 10 символов)" };
    return { ok: true, text: note ? `${REJECT_REASONS[key]}: ${note}` : REJECT_REASONS[key] };
  }
  if (action === "decline_return") {
    if (note.length < 10) return { ok: false, error: "Объясните покупателю, почему возврат невозможен (минимум 10 символов)" };
    return { ok: true, text: note };
  }
  return { ok: true, text: note };
}
