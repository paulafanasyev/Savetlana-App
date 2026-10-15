/**
 * Блок «Что сделать сегодня» на главной кабинета продавца. Чистый модуль:
 * из счётчиков делает список дел со ссылками. Сначала споры (у них сроки),
 * потом заказы, потом сообщения.
 */
import { badgeLabel, type BadgeKind } from "./badge-text";

export interface TodoCounts {
  orders: number;
  messages: number;
  disputes: number;
}

export interface TodoItem {
  kind: BadgeKind;
  href: string;
  text: string;
}

const ORDER: { kind: BadgeKind; href: string }[] = [
  { kind: "disputes", href: "/seller/disputes" },
  { kind: "orders", href: "/seller/orders" },
  { kind: "messages", href: "/seller/messages" },
];

export function sellerTodo(counts: TodoCounts): TodoItem[] {
  return ORDER.flatMap(({ kind, href }) => {
    const text = badgeLabel(kind, counts[kind]);
    return text ? [{ kind, href, text }] : [];
  });
}
