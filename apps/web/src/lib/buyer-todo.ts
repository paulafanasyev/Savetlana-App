/**
 * «Что мне сделать сегодня?» для покупателя: что ждёт его действий по
 * заказам. Чистый модуль: из заказов делает список дел со ссылками.
 * Сначала споры, потом оплата, потом готовые к выдаче, доставленные
 * (проверить и оставить отзыв) и в конце заказы в пути.
 */

export interface BuyerOrderLike {
  id: string;
  number: string;
  status: string;
}

export type BuyerTodoKind = "dispute" | "pay" | "pickup" | "review" | "in_transit";

export interface BuyerTodoItem {
  kind: BuyerTodoKind;
  href: string;
  text: string;
}

interface Group {
  kind: BuyerTodoKind;
  statuses: readonly string[];
  one: (number: string) => string;
  many: (count: number) => string;
  manyHref: string;
}

const GROUPS: readonly Group[] = [
  { kind: "dispute", statuses: ["DISPUTED"], one: (n) => `Спор по заказу ${n}: проверьте, не нужен ли ваш ответ`, many: (c) => `Открытые споры по заказам: ${c}`, manyHref: "/disputes" },
  { kind: "pay", statuses: ["CREATED", "PAYMENT_PENDING"], one: (n) => `Оплатите заказ ${n}`, many: (c) => `Ждут оплаты заказов: ${c}`, manyHref: "/orders" },
  { kind: "pickup", statuses: ["READY"], one: (n) => `Заберите заказ ${n}: он готов к выдаче`, many: (c) => `Готовы к выдаче заказов: ${c}`, manyHref: "/orders" },
  { kind: "review", statuses: ["DELIVERED"], one: (n) => `Заказ ${n} доставлен: проверьте товар и оставьте отзыв`, many: (c) => `Доставлено заказов: ${c}. Проверьте товары и оставьте отзывы`, manyHref: "/orders" },
  { kind: "in_transit", statuses: ["HANDED_TO_CARRIER", "IN_TRANSIT"], one: (n) => `Заказ ${n} в пути`, many: (c) => `В пути заказов: ${c}`, manyHref: "/orders" },
];

/** Статусы, по которым у покупателя есть дело или новость. */
export const BUYER_TODO_STATUSES: readonly string[] = GROUPS.flatMap((g) => g.statuses);

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_NUMBER = /^[A-Za-zА-Яа-яЁё0-9 _#№-]{1,40}$/;

export function buyerTodo(orders: readonly BuyerOrderLike[]): BuyerTodoItem[] {
  const items: BuyerTodoItem[] = [];
  for (const group of GROUPS) {
    const matched = orders.filter((o) => group.statuses.includes(o.status));
    if (matched.length === 0) continue;
    const only = matched[0];
    if (matched.length === 1 && SAFE_ID.test(only.id) && SAFE_NUMBER.test(only.number)) {
      items.push({ kind: group.kind, href: `/orders/${only.id}`, text: group.one(only.number) });
    } else {
      items.push({ kind: group.kind, href: group.manyHref, text: group.many(matched.length) });
    }
  }
  return items;
}
