/**
 * Способы доставки, которые покупатель выбирает при оформлении. Цена доставки
 * входит в сумму заказа до оплаты и потом не меняется.
 * Файл без серверных зависимостей: его используют и страница, и API.
 */
export type DeliveryMethod = "PICKUP" | "SELLER";

export interface DeliveryOption {
  method: DeliveryMethod;
  label: string;
  hint: string;
  priceKopecks: number;
  needsAddress: boolean;
}

/** Фиксированный тариф доставки продавцом, 350 ₽. */
export const SELLER_DELIVERY_KOPECKS = 35_000;

export const DELIVERY_OPTIONS: readonly DeliveryOption[] = [
  { method: "PICKUP", label: "Самовывоз у продавца", hint: "Продавец напишет, куда и когда подойти", priceKopecks: 0, needsAddress: false },
  { method: "SELLER", label: "Доставка продавцом", hint: "Привезёт по указанному адресу", priceKopecks: SELLER_DELIVERY_KOPECKS, needsAddress: true },
];

export function isDeliveryMethod(value: unknown): value is DeliveryMethod {
  return value === "PICKUP" || value === "SELLER";
}

export function deliveryPrice(method: DeliveryMethod): number {
  return DELIVERY_OPTIONS.find((o) => o.method === method)?.priceKopecks ?? 0;
}

export function deliveryLabel(method: string | null | undefined): string {
  return DELIVERY_OPTIONS.find((o) => o.method === method)?.label ?? "Самовывоз у продавца";
}
