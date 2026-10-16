/**
 * Безопасная сделка для услуг. Заказ услуги живёт в той же таблице заказов,
 * что и товары: оплата, расчёт с исполнителем, выплата, спор и автоприёмка
 * работают одинаково. Отличие хранится в поле адреса доставки (JSON):
 * kind = "SERVICE", какое объявление, кто исполнитель и срок. Доставки у
 * услуги нет, поэтому исполнитель сам отмечает «Работа сдана», а дальше всё
 * как с товаром: деньги у площадки, пока заказчик не примет работу или не
 * пройдёт ACCEPT_DAYS дней без спора. Здесь только чистые правила.
 */
import { ACCEPT_DAYS, autoAcceptAt } from "./safe-deal";

export const SERVICE_KIND = "SERVICE";
export const WORK_REPORT_MIN = 10;
export const WORK_REPORT_MAX = 1000;

export interface ServiceMeta {
  kind: typeof SERVICE_KIND;
  classifiedId: string;
  performerId: string;
  days: number;
  title: string;
}

export function serviceAddress(meta: Omit<ServiceMeta, "kind">): string {
  return JSON.stringify({ kind: SERVICE_KIND, ...meta, title: meta.title.slice(0, 120) });
}

/** Метаданные услуги из заказа. null: это обычный заказ товара. */
export function serviceMeta(deliveryAddress: string | null | undefined): ServiceMeta | null {
  try {
    const v = JSON.parse(deliveryAddress ?? "{}") as Partial<ServiceMeta>;
    if (v.kind !== SERVICE_KIND || typeof v.classifiedId !== "string" || typeof v.performerId !== "string") return null;
    return {
      kind: SERVICE_KIND,
      classifiedId: v.classifiedId,
      performerId: v.performerId,
      days: typeof v.days === "number" ? v.days : 0,
      title: typeof v.title === "string" ? v.title : "Услуга",
    };
  } catch {
    return null;
  }
}

export function isServiceOrder(deliveryAddress: string | null | undefined): boolean {
  return serviceMeta(deliveryAddress) !== null;
}

/**
 * Лишние переходы только для услуг: из «Оплачен» сразу в «Сдано», минуя
 * доставку. Товару так нельзя: он доставляется перевозчиком.
 */
export const SERVICE_EXTRA_TRANSITIONS: Record<string, string[]> = {
  PAID: ["DELIVERED"],
  CONFIRMED: ["DELIVERED"],
};

/** С какого статуса исполнитель может сдать работу. */
export const WORK_SUBMIT_FROM = ["PAID", "CONFIRMED"];

/** Ключ, по которому на одно объявление создаётся ровно одна сделка (защита от двойного выбора). */
export const serviceGroupKey = (classifiedId: string) => `svc_${classifiedId}`;

export function cleanWorkReport(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (text.length < WORK_REPORT_MIN) return { ok: false, error: `Опишите, что сделано: хотя бы ${WORK_REPORT_MIN} символов` };
  if (text.length > WORK_REPORT_MAX) return { ok: false, error: `Отчёт длиннее ${WORK_REPORT_MAX} символов, сократите его` };
  return { ok: true, text };
}

function ruDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Где деньги по заказу услуги: текст для заказчика. */
export function serviceCustomerNote(status: string, deliveredAt?: Date | null): string | null {
  if (status === "CREATED" || status === "PAYMENT_PENDING") return "Оплатите заказ: деньги будут храниться у площадки, исполнитель получит их только после того, как вы примете работу.";
  if (status === "PAID" || status === "CONFIRMED") return "Безопасная сделка: деньги у площадки. Исполнитель работает; когда он сдаст работу, придёт уведомление.";
  if (status === "DELIVERED") {
    const when = deliveredAt ? ` ${ruDate(autoAcceptAt(deliveredAt))}` : ` через ${ACCEPT_DAYS} дней после сдачи`;
    return `Исполнитель сдал работу. Проверьте результат: если всё в порядке, нажмите «Работа принята». Если не принять и не открыть спор, деньги уйдут исполнителю автоматически${when}.`;
  }
  if (status === "DISPUTED" || status === "RETURN_REQUESTED" || status === "RETURNING") return "Деньги у площадки и не уйдут исполнителю, пока не решится спор.";
  if (status === "COMPLETED") return "Работа принята, деньги переданы исполнителю.";
  return null;
}

/** То же для исполнителя. */
export function servicePerformerNote(status: string): string {
  if (status === "CREATED" || status === "PAYMENT_PENDING") return "Ждём оплату заказчика. Не начинайте работу, пока заказ не оплачен: так деньги защищены.";
  if (status === "PAID" || status === "CONFIRMED") return "Заказ оплачен, деньги у площадки. Сделайте работу и нажмите «Сдать работу».";
  if (status === "DELIVERED") return `Работа сдана, ждём приёмки. Если заказчик не откроет спор, деньги станут доступны через ${ACCEPT_DAYS} дней.`;
  if (status === "COMPLETED") return "Заказчик принял работу, деньги доступны к выплате в разделе «Выплаты».";
  if (status === "DISPUTED" || status === "RETURN_REQUESTED" || status === "RETURNING") return "Заказчик открыл спор: деньги заморожены до решения площадки.";
  if (status === "CANCELLED" || status === "REFUNDED") return "Сделка отменена, деньги вернулись заказчику.";
  return "Статус сделки обновляется.";
}
