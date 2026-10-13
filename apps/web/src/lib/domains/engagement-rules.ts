/**
 * Чистые правила переписки и акций продавца: без базы и без серверных
 * зависимостей, поэтому их легко проверять тестами.
 */

/** Ошибка, текст которой можно показать человеку как есть. */
export class UserFacingError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserFacingError";
    this.status = status;
  }
}

export const MESSAGE_MAX = 1000;
export const PROMO_MIN_PERCENT = 5;
export const PROMO_MAX_PERCENT = 70;

/** Чистит текст сообщения: пробелы по краям, не больше одной пустой строки подряд, лимит длины. */
export function cleanMessage(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (!text) throw new UserFacingError("Напишите сообщение");
  if (text.length > MESSAGE_MAX) throw new UserFacingError(`Сообщение длиннее ${MESSAGE_MAX} символов, сократите его`);
  return text;
}

export interface InboxRow {
  counterpartId: string;
  body: string;
  createdAt: Date;
  incoming: boolean;
  read: boolean;
}

export interface InboxThread {
  counterpartId: string;
  lastBody: string;
  lastAt: Date;
  lastIncoming: boolean;
  unread: number;
}

/** Группирует сообщения по собеседнику, свежие переписки сверху. */
export function buildInbox(rows: InboxRow[]): InboxThread[] {
  const threads = new Map<string, InboxThread>();
  for (const row of rows) {
    const t = threads.get(row.counterpartId);
    if (!t) {
      threads.set(row.counterpartId, {
        counterpartId: row.counterpartId,
        lastBody: row.body,
        lastAt: row.createdAt,
        lastIncoming: row.incoming,
        unread: row.incoming && !row.read ? 1 : 0,
      });
      continue;
    }
    if (row.createdAt > t.lastAt) {
      t.lastBody = row.body;
      t.lastAt = row.createdAt;
      t.lastIncoming = row.incoming;
    }
    if (row.incoming && !row.read) t.unread += 1;
  }
  return [...threads.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** Цена со скидкой, округлённая до рубля. */
export function promoPrice(priceKopecks: number, percent: number): number {
  if (!Number.isInteger(percent) || percent < PROMO_MIN_PERCENT || percent > PROMO_MAX_PERCENT) {
    throw new UserFacingError(`Скидка должна быть от ${PROMO_MIN_PERCENT} до ${PROMO_MAX_PERCENT}%`);
  }
  const next = Math.max(100, Math.round((priceKopecks * (100 - percent)) / 100 / 100) * 100);
  if (next >= priceKopecks) throw new UserFacingError("Цена слишком маленькая для такой скидки");
  return next;
}

/** Идёт ли по товару скидка: зачёркнутая цена выше текущей. */
export function promoState(p: { priceKopecks: number; oldPriceKopecks: number | null }): { onPromo: boolean; percent: number } {
  if (!p.oldPriceKopecks || p.oldPriceKopecks <= p.priceKopecks) return { onPromo: false, percent: 0 };
  return { onPromo: true, percent: Math.round(((p.oldPriceKopecks - p.priceKopecks) / p.oldPriceKopecks) * 100) };
}
