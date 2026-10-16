/**
 * Фриланс: предложения исполнителей по заказам на услуги («Нужна услуга»).
 *
 * Предложение: цена, срок и пара слов о том, как исполнитель сделает работу.
 * Хранится как обычный отклик на объявление (classified-replies.ts) с
 * размеченной первой строкой, поэтому переписка, антифрод и уведомления
 * работают как у остальных объявлений, а отдельная таблица не нужна.
 * Здесь только чистые правила: разбор, проверка, сортировка.
 */

export const BID_MARK = "💼 Предложение:";
export const CHOSEN_MARK = "✅ Заказчик выбрал вас исполнителем";
export const NOT_CHOSEN_MARK = "Заказчик выбрал другого исполнителя";

export const BID_MIN_RUB = 100;
export const BID_MAX_RUB = 10_000_000;
export const BID_MAX_DAYS = 365;
export const BID_TEXT_MIN = 10;
export const BID_TEXT_MAX = 800;

/** Предложения с ценой и сроком принимаются только по заказам на услуги. */
export function isBidAd(ad: { vertical: string; dealType: string }): boolean {
  return ad.vertical === "SERVICE" && ad.dealType === "SERVICE_REQUEST";
}

export function daysText(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "день" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "дня" : "дней";
  return `${n} ${word}`;
}

/** 15000 → «15 000 ₽» с обычными пробелами, чтобы строку можно было разобрать обратно. */
export function rubPlain(kopecks: number): string {
  return `${String(Math.round(kopecks / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

function toInt(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : NaN;
  if (typeof raw !== "string") return NaN;
  const digits = raw.replace(/[\s\u00a0₽руб.]/gi, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(digits)) return NaN;
  return Math.round(Number(digits));
}

export type BidInput = { priceKopecks: number; days: number; text: string };

export function parseBidInput(input: { price?: unknown; days?: unknown; text?: unknown }): { ok: true; bid: BidInput } | { ok: false; error: string } {
  const price = toInt(input.price);
  if (!Number.isFinite(price) || price < BID_MIN_RUB || price > BID_MAX_RUB) {
    return { ok: false, error: `Укажите цену от ${BID_MIN_RUB} до ${BID_MAX_RUB.toLocaleString("ru-RU")} ₽` };
  }
  const days = toInt(input.days);
  if (!Number.isInteger(days) || days < 1 || days > BID_MAX_DAYS) {
    return { ok: false, error: `Укажите срок от 1 до ${BID_MAX_DAYS} дней` };
  }
  const text = typeof input.text === "string" ? input.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (text.length < BID_TEXT_MIN) return { ok: false, error: `Расскажите, как сделаете работу: хотя бы ${BID_TEXT_MIN} символов` };
  if (text.length > BID_TEXT_MAX) return { ok: false, error: `Описание длиннее ${BID_TEXT_MAX} символов, сократите его` };
  return { ok: true, bid: { priceKopecks: price * 100, days, text } };
}

/** Текст отклика с размеченной первой строкой. */
export function bidBody(bid: BidInput): string {
  return `${BID_MARK} ${rubPlain(bid.priceKopecks)} · срок ${daysText(bid.days)}\n\n${bid.text}`;
}

const BID_LINE = /^💼 Предложение: ([\d ]+) ₽ · срок (\d+) \S+/;

/** Обратно из текста отклика. null: это обычное сообщение, не предложение. */
export function parseBidBody(body: string): BidInput | null {
  const m = BID_LINE.exec(body);
  if (!m) return null;
  const rub = Number((m[1] as string).replace(/ /g, ""));
  const days = Number(m[2]);
  if (!Number.isFinite(rub) || !Number.isInteger(days)) return null;
  return { priceKopecks: rub * 100, days, text: body.slice(m[0].length).trim() };
}

export interface BidRow {
  applicantId: string;
  body: string;
  createdAt: Date;
}

export interface Bid extends BidInput {
  applicantId: string;
  createdAt: Date;
}

/** Последнее предложение каждого исполнителя: новое заменяет прежнее. */
export function latestBids(rows: BidRow[]): Bid[] {
  const latest = new Map<string, Bid>();
  for (const r of rows) {
    const parsed = parseBidBody(r.body);
    if (!parsed) continue;
    const prev = latest.get(r.applicantId);
    if (!prev || r.createdAt.getTime() > prev.createdAt.getTime()) latest.set(r.applicantId, { ...parsed, applicantId: r.applicantId, createdAt: r.createdAt });
  }
  return [...latest.values()];
}

export type BidSort = "price" | "days" | "new";

export function bidSort(raw: unknown): BidSort {
  return raw === "days" || raw === "new" ? raw : "price";
}

export function sortBids<T extends Bid>(bids: T[], by: BidSort): T[] {
  const copy = [...bids];
  if (by === "days") return copy.sort((a, b) => a.days - b.days || a.priceKopecks - b.priceKopecks);
  if (by === "new") return copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return copy.sort((a, b) => a.priceKopecks - b.priceKopecks || a.days - b.days);
}
