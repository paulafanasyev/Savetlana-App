/**
 * Блок «Что сделать сегодня» на главной кабинета продавца. Чистый модуль:
 * из счётчиков делает список дел со ссылками. Сначала споры (у них сроки),
 * потом заказы, потом сообщения, в конце товары, которые закончились
 * или скоро закончатся.
 */
import { badgeLabel, type BadgeKind } from "./badge-text";

export interface TodoCounts {
  orders: number;
  messages: number;
  disputes: number;
}

export type TodoKind = BadgeKind | "stock_out" | "stock_low";

export interface TodoItem {
  kind: TodoKind;
  href: string;
  text: string;
}

const ORDER: { kind: BadgeKind; href: string }[] = [
  { kind: "disputes", href: "/seller/disputes" },
  { kind: "orders", href: "/seller/orders" },
  { kind: "messages", href: "/seller/messages" },
];

/** Куда вести продавца с заканчивающимися товарами: там остатки меняются сразу у нескольких. */
export const STOCK_HREF = "/seller/products/bulk";

function goodsWord(n: number): "товар" | "товара" | "товаров" {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "товар";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "товара";
  return "товаров";
}

/** Подпись про остатки: «1 товар закончился», «3 товара скоро закончатся». */
export function stockText(kind: "stock_out" | "stock_low", count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return "";
  const one = goodsWord(n) === "товар";
  const verb = kind === "stock_out" ? (one ? "закончился" : "закончились") : one ? "скоро закончится" : "скоро закончатся";
  return `${n} ${goodsWord(n)} ${verb}`;
}

export function sellerTodo(counts: TodoCounts, lowStock?: readonly { quantity: number }[] | null): TodoItem[] {
  const items: TodoItem[] = ORDER.flatMap(({ kind, href }) => {
    const text = badgeLabel(kind, counts[kind]);
    return text ? [{ kind, href, text }] : [];
  });
  const stock = lowStock ?? [];
  const out = stock.filter((s) => s.quantity <= 0).length;
  const low = stock.length - out;
  for (const [kind, n] of [["stock_out", out], ["stock_low", low]] as const) {
    const text = stockText(kind, n);
    if (text) items.push({ kind, href: STOCK_HREF, text });
  }
  return items;
}
