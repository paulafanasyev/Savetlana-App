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

const ALL_WORDS = new Set(["все", "всё", "весь", "всю", "товары", "товар", "товаров", "мои", "моих", "мой", "ассортимент", "магазин", "каталог", "позиции"]);

/**
 * Какие товары продавца имеет в виду фраза: «кроссовки Nike», «все товары».
 * Слова сравниваются по основе (без двух последних букв), чтобы «кроссовок»
 * находило «Кроссовки». Пустой запрос или «все товары» означает весь ассортимент.
 */
export function matchProducts<T extends { title: string }>(products: T[], query: string | undefined | null): T[] {
  const words = (query ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 3 && !ALL_WORDS.has(w));
  if (words.length === 0) return products;
  const stems = words.map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));
  return products.filter((p) => {
    const title = p.title.toLowerCase().replace(/ё/g, "е");
    return stems.every((s) => title.includes(s));
  });
}

export const PROMO_FAIR_PRICE_DAYS = 14;
/** За сколько дней смотрим журнал цен, чтобы отличить возврат цены после акции от повышения. */
export const PRICE_HISTORY_LOOKBACK_DAYS = 90;

/**
 * Товары, цену которых повышали за последние `days` дней. От такой цены
 * скидку запускать нельзя: зачёркнутая цена должна быть настоящей, а не
 * поднятой перед акцией. Возврат к цене, которая уже была до снижения
 * (например, конец прошлой акции), повышением не считается.
 */
export function raisedRecently(
  changes: { productId: string; change: string | null; createdAt: Date }[],
  now: Date = new Date(),
  days: number = PROMO_FAIR_PRICE_DAYS
): Set<string> {
  const since = now.getTime() - days * 86_400_000;
  const sorted = [...changes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const baselines = new Map<string, Set<number>>();
  const raised = new Set<string>();
  for (const c of sorted) {
    let from: unknown;
    let to: unknown;
    try {
      const d = JSON.parse(c.change ?? "{}") as { priceFrom?: unknown; priceTo?: unknown };
      from = d.priceFrom;
      to = d.priceTo;
    } catch {
      continue; // повреждённая запись истории: не гадаем
    }
    if (typeof from !== "number" || typeof to !== "number") continue;
    const known = baselines.get(c.productId) ?? new Set<number>();
    baselines.set(c.productId, known);
    if (to < from) {
      known.add(from);
    } else if (to > from && !known.has(to) && c.createdAt.getTime() >= since) {
      raised.add(c.productId);
    }
  }
  return raised;
}

export const PROMO_MAX_DAYS = 30;

/** Когда закончится акция на `days` дней. Без срока: null. */
export function promoEndsAt(days: unknown, now: Date = new Date()): Date | null {
  if (days === undefined || days === null || days === "" || days === 0 || days === "0") return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > PROMO_MAX_DAYS) {
    throw new UserFacingError(`Срок акции: от 1 до ${PROMO_MAX_DAYS} дней`);
  }
  return new Date(now.getTime() + n * 86_400_000);
}

/** «20 октября»: дата окончания акции для людей (по Москве). */
export function promoDateText(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

const DURATION_DAYS = /(?:^|\s)(?:на\s+)?(\d{1,2})\s*(?:дн\S*|день|сут\S*)(?=\s|$)/i;
const DURATION_WORDS = /(?:^|\s)(?:на\s+)?(неделю|две недели|месяц)(?=\s|$)/i;

/**
 * Срок акции из фразы продавца: «кроссовки на 3 дня» → { rest: "кроссовки", days: 3 }.
 * Без срока возвращает исходный текст.
 */
export function extractPromoDuration(text: string): { rest: string; days?: number } {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^на\s+/i, "");
  const d = DURATION_DAYS.exec(text);
  if (d) return { rest: clean(text.replace(d[0], " ")), days: Number(d[1]) };
  const w = DURATION_WORDS.exec(text);
  if (w) {
    const word = w[1].toLowerCase();
    return { rest: clean(text.replace(w[0], " ")), days: word === "неделю" ? 7 : word === "две недели" ? 14 : 30 };
  }
  return { rest: clean(text) };
}

export interface PromoHistoryRow {
  productId: string;
  sellerId: string;
  actorId: string | null;
  change: string | null;
  createdAt: Date;
}

/** Запуск акции, записанный в журнале цен: какая цена стала и до какого числа. */
export function promoMark(row: { change: string | null }): { priceTo: number; endsAt: Date | null } | null {
  try {
    const d = JSON.parse(row.change ?? "{}") as { priceTo?: unknown; promoPercent?: unknown; promoEndsAt?: unknown };
    if (typeof d.priceTo !== "number" || typeof d.promoPercent !== "number") return null;
    const endsAt = typeof d.promoEndsAt === "string" ? new Date(d.promoEndsAt) : null;
    return { priceTo: d.priceTo, endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null };
  } catch {
    return null;
  }
}

/**
 * Акции, у которых вышел срок: берём последнюю запись запуска по каждому
 * товару и сравниваем дату окончания с текущим временем.
 */
export function duePromotions(rows: PromoHistoryRow[], now: Date = new Date()): (PromoHistoryRow & { priceTo: number })[] {
  const latest = new Map<string, PromoHistoryRow>();
  for (const row of rows) {
    if (!promoMark(row)) continue;
    const prev = latest.get(row.productId);
    if (!prev || row.createdAt > prev.createdAt) latest.set(row.productId, row);
  }
  const due: (PromoHistoryRow & { priceTo: number })[] = [];
  for (const row of latest.values()) {
    const mark = promoMark(row);
    if (mark?.endsAt && mark.endsAt.getTime() <= now.getTime()) due.push({ ...row, priceTo: mark.priceTo });
  }
  return due;
}
