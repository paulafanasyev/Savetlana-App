/**
 * CRM продавца: покупатели магазина, их сегменты и выручка по месяцам.
 *
 * Считается из реальных заказов, без отдельной таблицы: всё, что продавец
 * видит, подтверждено оплаченными заказами. Контакты не раскрываются шире,
 * чем на странице заказов (почта маскируется).
 */
import { prisma } from "../prisma";

/** Статусы, при которых заказ считается продажей (оплачен и не отменён/не возвращён). */
export const SOLD_STATUSES = ["PAID", "CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED", "COMPLETED"];

export type CustomerSegment = "VIP" | "REGULAR" | "NEW" | "SLEEPING" | "ONE_TIME";

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  VIP: "VIP",
  REGULAR: "Постоянный",
  NEW: "Новый",
  SLEEPING: "Давно не покупал",
  ONE_TIME: "Разовый",
};

export interface CrmOrder {
  buyerId: string;
  buyerName: string | null;
  buyerEmail: string;
  totalKopecks: number;
  createdAt: Date;
  items: { titleSnapshot: string; quantity: number }[];
}

export interface CrmCustomer {
  buyerId: string;
  name: string;
  emailMasked: string;
  ordersCount: number;
  totalKopecks: number;
  avgCheckKopecks: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  favoriteProduct: string | null;
  segment: CustomerSegment;
}

export interface CrmReport {
  customers: CrmCustomer[];
  totals: {
    customers: number;
    repeatCustomers: number;
    repeatRatePercent: number;
    revenueKopecks: number;
    avgCheckKopecks: number;
    avgCustomerValueKopecks: number;
  };
  segments: Record<CustomerSegment, number>;
  months: { key: string; label: string; revenueKopecks: number; orders: number }[];
  advice: string[];
}

const DAY = 24 * 60 * 60 * 1000;
const VIP_SPEND_KOPECKS = 30_000 * 100;

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "скрыт";
  return `${user.slice(0, 2)}***@${domain}`;
}

function segmentOf(ordersCount: number, totalKopecks: number, firstOrderAt: Date, lastOrderAt: Date, now: Date): CustomerSegment {
  if (ordersCount >= 3 || totalKopecks >= VIP_SPEND_KOPECKS) return "VIP";
  if (now.getTime() - lastOrderAt.getTime() > 90 * DAY) return "SLEEPING";
  if (ordersCount >= 2) return "REGULAR";
  if (now.getTime() - firstOrderAt.getTime() <= 30 * DAY) return "NEW";
  return "ONE_TIME";
}

function buyers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "покупатель" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "покупателя" : "покупателей";
  return `${n} ${word}`;
}

function rubText(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

/** Чистая функция: из списка проданных заказов строит отчёт CRM. */
export function buildCustomerReport(orders: CrmOrder[], now: Date = new Date()): CrmReport {
  const byBuyer = new Map<string, CrmOrder[]>();
  for (const order of orders) {
    const list = byBuyer.get(order.buyerId) ?? [];
    list.push(order);
    byBuyer.set(order.buyerId, list);
  }

  const customers: CrmCustomer[] = [...byBuyer.entries()].map(([buyerId, list]) => {
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const total = sorted.reduce((sum, o) => sum + o.totalKopecks, 0);
    const products = new Map<string, number>();
    for (const o of sorted) for (const item of o.items) products.set(item.titleSnapshot, (products.get(item.titleSnapshot) ?? 0) + item.quantity);
    const favorite = [...products.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const first = sorted[0].createdAt;
    const last = sorted[sorted.length - 1].createdAt;
    return {
      buyerId,
      name: sorted[sorted.length - 1].buyerName?.trim() || "Покупатель",
      emailMasked: maskEmail(sorted[0].buyerEmail),
      ordersCount: sorted.length,
      totalKopecks: total,
      avgCheckKopecks: Math.round(total / sorted.length),
      firstOrderAt: first,
      lastOrderAt: last,
      favoriteProduct: favorite,
      segment: segmentOf(sorted.length, total, first, last, now),
    };
  });
  customers.sort((a, b) => b.totalKopecks - a.totalKopecks);

  const segments: Record<CustomerSegment, number> = { VIP: 0, REGULAR: 0, NEW: 0, SLEEPING: 0, ONE_TIME: 0 };
  for (const c of customers) segments[c.segment] += 1;

  const revenue = orders.reduce((sum, o) => sum + o.totalKopecks, 0);
  const repeat = customers.filter((c) => c.ordersCount >= 2).length;

  const monthFmt = new Intl.DateTimeFormat("ru-RU", { month: "short" });
  const months: CrmReport["months"] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: monthFmt.format(d).replace(".", ""), revenueKopecks: 0, orders: 0 });
  }
  for (const o of orders) {
    const key = `${o.createdAt.getFullYear()}-${String(o.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const m = months.find((x) => x.key === key);
    if (m) {
      m.revenueKopecks += o.totalKopecks;
      m.orders += 1;
    }
  }

  const advice: string[] = [];
  if (customers.length === 0) {
    advice.push("Покупателей пока нет. Проверьте, что у товаров есть фото, цена и подтверждённый остаток: без этого карточку не видно покупателям.");
  } else {
    if (segments.SLEEPING > 0) advice.push(`Давно не заказывали: ${buyers(segments.SLEEPING)}. Сделайте скидку на их любимые товары, чтобы они вернулись.`);
    if (segments.NEW > 0) advice.push(`Новых за месяц: ${buyers(segments.NEW)}. Аккуратная упаковка и быстрая отправка превращают их в постоянных.`);
    if (segments.VIP > 0) advice.push(`VIP: ${buyers(segments.VIP)}, вместе принесли ${rubText(customers.filter((c) => c.segment === "VIP").reduce((s, c) => s + c.totalKopecks, 0))}. Держите для них товар в наличии.`);
    if (customers.length >= 3 && repeat / customers.length < 0.2) advice.push("Повторных покупок меньше 20%. Добавьте сопутствующие товары, чтобы покупатели возвращались.");
  }

  return {
    customers,
    totals: {
      customers: customers.length,
      repeatCustomers: repeat,
      repeatRatePercent: customers.length ? Math.round((repeat / customers.length) * 100) : 0,
      revenueKopecks: revenue,
      avgCheckKopecks: orders.length ? Math.round(revenue / orders.length) : 0,
      avgCustomerValueKopecks: customers.length ? Math.round(revenue / customers.length) : 0,
    },
    segments,
    months,
    advice,
  };
}

/** Сколько заказов читаем за раз и сколько всего (защита от бесконечного отчёта). */
const CRM_BATCH = 1000;
const CRM_MAX_ORDERS = 50_000;

/**
 * Заказы читаем пачками по 1000, а не одним запросом «первые 2000»: у
 * крупного магазина иначе терялись старые покупатели и выручка.
 */
export async function sellerCustomerReport(sellerId: string, now: Date = new Date()): Promise<CrmReport> {
  const orders: CrmOrder[] = [];
  let cursor: string | undefined;
  while (orders.length < CRM_MAX_ORDERS) {
    const rows = await prisma.order.findMany({
      where: { sellerId, status: { in: SOLD_STATUSES } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CRM_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        buyerId: true,
        totalKopecks: true,
        createdAt: true,
        buyer: { select: { name: true, email: true } },
        items: { select: { titleSnapshot: true, quantity: true } },
      },
    });
    for (const r of rows) {
      orders.push({
        buyerId: r.buyerId,
        buyerName: r.buyer.name,
        buyerEmail: r.buyer.email,
        totalKopecks: r.totalKopecks,
        createdAt: r.createdAt,
        items: r.items,
      });
    }
    if (rows.length < CRM_BATCH) break;
    cursor = rows[rows.length - 1].id;
  }
  return buildCustomerReport(orders, now);
}
