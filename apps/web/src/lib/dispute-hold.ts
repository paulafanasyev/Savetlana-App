/**
 * Спор держит деньги в безопасной сделке.
 *
 * Пока по заказу идёт спор (или покупатель выиграл и возврат ещё не прошёл),
 * заказ не завершается автоприёмкой, а его расчёт не уходит в выплату продавцу.
 * RESOLVED_SELLER и CLOSED деньги не держат.
 */
export const PAYOUT_BLOCKING_DISPUTE_STATUSES = [
  "OPEN",
  "EVIDENCE_COLLECTION",
  "ESCALATED_HUMAN",
  "RESOLVED_BUYER",
] as const;

/** Возвраты, которые ещё не завершились: пока они идут, выплата по заказу закрыта. */
export const PAYOUT_BLOCKING_REFUND_STATUSES = ["PENDING", "PROCESSING"] as const;
