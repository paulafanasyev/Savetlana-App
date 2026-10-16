/**
 * Платное продвижение в правой колонке сайта: тарифы, сроки, честная ротация.
 * Чистые функции без базы.
 *
 * Цены выбраны ниже самого дешёвого продвижения, которое мы нашли у Авито
 * (83 ₽ за 14 дней в небольшом городе, около 6 ₽ в сутки; в Москве от 279 ₽).
 * У нас от 5 ₽ за сутки, а месяц выходит меньше 3 ₽ в сутки.
 */

export type PromoKind = "classified" | "product";

export interface PromoPlan {
  id: "day" | "week" | "month";
  days: number;
  priceRub: number;
  label: string;
}

export const PROMO_PLANS: readonly PromoPlan[] = [
  { id: "day", days: 1, priceRub: 5, label: "1 день" },
  { id: "week", days: 7, priceRub: 29, label: "7 дней" },
  { id: "month", days: 30, priceRub: 79, label: "30 дней" },
];

export const PROMO_RAIL_SIZE = 4;
const DAY_MS = 86_400_000;

export function findPlan(id: unknown): PromoPlan | null {
  return PROMO_PLANS.find((p) => p.id === id) ?? null;
}

/** «2,63 ₽ в сутки» */
export function perDay(plan: PromoPlan): string {
  const v = Math.round((plan.priceRub / plan.days) * 100) / 100;
  return `${String(v).replace(".", ",")} ₽ в сутки`;
}

export interface PromoOrder {
  planId: PromoPlan["id"];
  priceRub: number;
  at: string;
}

export interface Promotion {
  kind: PromoKind;
  itemId: string;
  ownerId: string;
  startsAt: string;
  endsAt: string;
  paidRub: number;
  orders: PromoOrder[];
  /** Оплата в тестовом режиме: деньги не списывались. */
  sandbox: boolean;
}

export function isActive(p: Pick<Promotion, "startsAt" | "endsAt">, now: Date): boolean {
  const t = now.getTime();
  return Date.parse(p.startsAt) <= t && t < Date.parse(p.endsAt);
}

/** Новый срок: если продвижение ещё идёт, дни добавляются к концу, иначе считаем от сейчас. */
export function applyPlan(existing: Promotion | null, plan: PromoPlan, base: Omit<Promotion, "startsAt" | "endsAt" | "paidRub" | "orders">, now: Date): Promotion {
  const order: PromoOrder = { planId: plan.id, priceRub: plan.priceRub, at: now.toISOString() };
  if (existing && isActive(existing, now)) {
    return {
      ...existing,
      endsAt: new Date(Date.parse(existing.endsAt) + plan.days * DAY_MS).toISOString(),
      paidRub: existing.paidRub + plan.priceRub,
      orders: [...existing.orders, order].slice(-50),
    };
  }
  return {
    ...base,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + plan.days * DAY_MS).toISOString(),
    paidRub: (existing?.paidRub ?? 0) + plan.priceRub,
    orders: [...(existing?.orders ?? []), order].slice(-50),
  };
}

/** Разбор записи из базы; мусор отбрасываем. */
export function parsePromotion(raw: string | null | undefined): Promotion | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Promotion>;
    if (p.kind !== "classified" && p.kind !== "product") return null;
    if (typeof p.itemId !== "string" || typeof p.ownerId !== "string") return null;
    if (typeof p.startsAt !== "string" || typeof p.endsAt !== "string") return null;
    if (Number.isNaN(Date.parse(p.startsAt)) || Number.isNaN(Date.parse(p.endsAt))) return null;
    return {
      kind: p.kind,
      itemId: p.itemId,
      ownerId: p.ownerId,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      paidRub: typeof p.paidRub === "number" ? p.paidRub : 0,
      orders: Array.isArray(p.orders) ? p.orders : [],
      sandbox: p.sandbox !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Кого показать в колонке: каждому продвигаемому одинаковый шанс, без повторов.
 * rand передаётся снаружи, чтобы тесты были предсказуемыми.
 */
export function pickForRail<T>(items: T[], n: number, rand: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}

/** Сколько осталось: «ещё 3 дня», «ещё 5 часов». */
export function timeLeft(p: Pick<Promotion, "endsAt">, now: Date): string {
  const ms = Date.parse(p.endsAt) - now.getTime();
  if (ms <= 0) return "закончилось";
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `ещё ${days} ${plural(days, "день", "дня", "дней")}`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `ещё ${hours} ${plural(hours, "час", "часа", "часов")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
