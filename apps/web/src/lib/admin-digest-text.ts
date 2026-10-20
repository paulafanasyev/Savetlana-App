/**
 * Текст ежедневной сводки администратору. Чистый модуль: из счётчиков за сутки
 * делает заголовок и текст. Если ничего не произошло и решать нечего: null, сводка не шлётся.
 */
import { countText } from "./format";

export interface DigestCounts {
  newUsers: number;
  newSellers: number;
  applications: number;
  queue: number;
  newProducts: number;
  orders: number;
  /** Категории фоновых задач, упавшие при прошлом запуске. */
  jobFailures: string[];
}

const FORMS = {
  people: ["человек", "человека", "человек"],
  sellers: ["новый продавец", "новых продавца", "новых продавцов"],
  apps: ["заявка", "заявки", "заявок"],
  products: ["новый товар", "новых товара", "новых товаров"],
  orders: ["заказ", "заказа", "заказов"],
} as const;

export function digestText(c: DigestCounts): { title: string; body: string } | null {
  const happened = c.newUsers + c.newSellers + c.applications + c.newProducts + c.orders;
  if (happened === 0 && c.queue === 0 && c.jobFailures.length === 0) return null;
  const parts: string[] = [];
  parts.push(`За сутки: регистраций ${countText(c.newUsers, FORMS.people)}, ${countText(c.newSellers, FORMS.sellers)}, ${countText(c.applications, FORMS.apps)} на проверку, ${countText(c.newProducts, FORMS.products)} в продаже, ${countText(c.orders, FORMS.orders)}.`);
  if (c.queue > 0) parts.push(`Ждут вашего решения: ${countText(c.queue, FORMS.apps)}.`);
  if (c.jobFailures.length > 0) parts.push(`Фоновые задачи с ошибкой: ${c.jobFailures.slice(0, 5).join(", ")}.`);
  const title = c.queue > 0 ? `Сводка АИКО: ждут проверки ${c.queue}` : c.jobFailures.length > 0 ? "Сводка АИКО: есть ошибки задач" : "Сводка АИКО за сутки";
  return { title, body: parts.join(" ") };
}
