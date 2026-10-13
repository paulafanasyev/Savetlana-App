import {
  OrderStatus_VALUES,
  PaymentStatus_VALUES,
  ShipmentStatus_VALUES,
  ProductStatus_VALUES,
  AvailabilityStatus_VALUES,
  SettlementStatus_VALUES,
  PayoutStatus_VALUES,
} from "./db/enums";

type LabelMap = Record<string, string>;

export const orderStatusLabels: LabelMap = {
  CREATED: "Создан", PAYMENT_PENDING: "Ожидает оплаты", PAID: "Оплачен",
  CONFIRMED: "Подтверждён продавцом", PROCESSING: "Собирается", READY: "Готов к выдаче",
  HANDED_TO_CARRIER: "Передан в доставку", IN_TRANSIT: "В пути", DELIVERED: "Доставлен",
  COMPLETED: "Завершён", CANCELLED: "Отменён", RETURN_REQUESTED: "Запрошен возврат",
  RETURNING: "Возвращается", REFUNDED: "Возврат выполнен", DISPUTED: "Спор",
};
export const paymentStatusLabels: LabelMap = {
  PENDING: "Ожидает оплаты", AUTHORIZED: "Авторизован", CAPTURED: "Оплачен",
  SUCCEEDED: "Оплачен", FAILED: "Ошибка оплаты", REFUNDED: "Возвращён",
  PARTIALLY_REFUNDED: "Частично возвращён", PROCESSING: "Обрабатывается",
};
export const shipmentStatusLabels: LabelMap = {
  CREATED: "Создано", HANDED_OVER: "Передано в доставку", IN_TRANSIT: "В пути",
  DELIVERED: "Доставлено", FAILED: "Ошибка доставки", RETURNED: "Возвращено",
};
export const productStatusLabels: LabelMap = {
  DRAFT: "Черновик", PENDING_SELLER_APPROVAL: "Ждёт проверки", ACTIVE: "Опубликован",
  HIDDEN: "Скрыт", ARCHIVED: "В архиве",
};
export const availabilityLabels: LabelMap = {
  AVAILABLE: "В наличии", LIMITED: "Осталось мало", OUT_OF_STOCK: "Нет в наличии",
  PREORDER: "Предзаказ", MADE_TO_ORDER: "Под заказ", UNKNOWN: "Наличие уточняется",
};
export const settlementStatusLabels: LabelMap = {
  PENDING: "Ожидает доставки", AVAILABLE: "Доступно к выплате", PAID: "Выплачено", ADJUSTED: "Скорректировано",
};
export const payoutStatusLabels: LabelMap = {
  PENDING: "Ожидает", IN_PROGRESS: "В обработке", SUCCEEDED: "Выплачено", FAILED: "Ошибка",
};

export function orderStatusLabel(value: string | null | undefined): string { return value ? orderStatusLabels[value] ?? value : "—"; }
export function paymentStatusLabel(value: string | null | undefined): string { return value ? paymentStatusLabels[value] ?? value : "—"; }
export function shipmentStatusLabel(value: string | null | undefined): string { return value ? shipmentStatusLabels[value] ?? value : "—"; }
export function productStatusLabel(value: string | null | undefined): string { return value ? productStatusLabels[value] ?? value : "—"; }
export function availabilityLabel(value: string | null | undefined): string { return value ? availabilityLabels[value] ?? value : "Наличие уточняется"; }
export function settlementStatusLabel(value: string | null | undefined): string { return value ? settlementStatusLabels[value] ?? value : "—"; }
export function payoutStatusLabel(value: string | null | undefined): string { return value ? payoutStatusLabels[value] ?? value : "—"; }

/** Runtime assertion used by tests and admin renderers to avoid raw enum text. */
export function labelsCoverCanonicalEnums(): boolean {
  return [
    [OrderStatus_VALUES, orderStatusLabels], [PaymentStatus_VALUES, paymentStatusLabels],
    [ShipmentStatus_VALUES, shipmentStatusLabels], [ProductStatus_VALUES, productStatusLabels],
    [AvailabilityStatus_VALUES, availabilityLabels], [SettlementStatus_VALUES, settlementStatusLabels],
    [PayoutStatus_VALUES, payoutStatusLabels],
  ].every(([values, labels]) => (values as readonly string[]).every((value) => Boolean((labels as LabelMap)[value])));
}
