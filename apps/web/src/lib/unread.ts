/**
 * Счётчики непрочитанного для шапки сайта. Чистый модуль: можно
 * импортировать и на сервере, и в браузере.
 *
 * Сообщения хранятся как уведомления, поэтому делим непрочитанные
 * уведомления по виду: переписка покупателя (с магазинами и по объявлениям),
 * сообщения покупателей магазину и всё остальное.
 */

/** Сообщения, которые человек читает в разделе «Сообщения». */
export const INBOX_MESSAGE_KINDS = ["seller_message", "classified_reply", "classified_answer"] as const;
/** Сообщения покупателей магазину: читаются в кабинете продавца. */
export const SELLER_MESSAGE_KINDS = ["buyer_message"] as const;

export interface UnreadCounts {
  messages: number;
  sellerMessages: number;
  /** Остальные уведомления: заказы, споры, отзывы и прочее. */
  other: number;
}

export const NO_UNREAD: UnreadCounts = { messages: 0, sellerMessages: 0, other: 0 };

/** Раскладывает непрочитанные по видам. rows: результат группировки по kind. */
export function splitUnread(rows: { kind: string; count: number }[]): UnreadCounts {
  const out: UnreadCounts = { messages: 0, sellerMessages: 0, other: 0 };
  for (const r of rows) {
    const n = Number.isFinite(r.count) && r.count > 0 ? Math.floor(r.count) : 0;
    if ((INBOX_MESSAGE_KINDS as readonly string[]).includes(r.kind)) out.messages += n;
    else if ((SELLER_MESSAGE_KINDS as readonly string[]).includes(r.kind)) out.sellerMessages += n;
    else out.other += n;
  }
  return out;
}

/** Всего непрочитанного для значка у имени. */
export function totalUnread(c: UnreadCounts | null | undefined): number {
  return c ? c.messages + c.sellerMessages + c.other : 0;
}

/** Текст значка: пусто для нуля, «99+» для больших чисел. */
export function badgeText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > 99 ? "99+" : String(Math.floor(n));
}
