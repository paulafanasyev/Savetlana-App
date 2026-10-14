/**
 * Антифрод возвратов и споров (шаг 3): злоупотребления со стороны покупателя.
 *
 * Схемы:
 * - «не получил», хотя перевозчик отметил вручение (friendly fraud);
 * - серийные споры и возвраты: человек открывает спор почти по каждому заказу;
 * - новый аккаунт сразу спорит по дорогому заказу;
 * - много выигранных споров подряд у разных продавцов.
 *
 * Решение по спору всё равно принимает человек: права покупателя по закону
 * о защите прав потребителей никто не отменяет. Модуль только поднимает
 * сигналы для модератора и пишет их в журнал рисков. Чистый, без базы.
 */

export interface BuyerHistory {
  accountAgeDays: number;
  /** Заказы за 90 дней (без отменённых до оплаты). */
  ordersLast90: number;
  /** Споры за 90 дней, включая текущий. */
  disputesLast90: number;
  /** Споры за 90 дней, решённые в пользу покупателя. */
  disputesWonLast90: number;
  /** Разных продавцов в этих спорах. */
  distinctSellersInDisputes: number;
  /** Возвраты денег за 90 дней. */
  refundsLast90: number;
  /** Сколько раз за 90 дней покупатель писал «не получил», а перевозчик отметил вручение (включая текущий). */
  notReceivedButDelivered: number;
}

export interface CurrentDispute {
  reason: string;
  orderTotalKopecks: number;
  /** Перевозчик отметил вручение по этому заказу. */
  carrierDelivered: boolean;
}

export interface BuyerSignal {
  code: string;
  weight: number;
  text: string;
}

export interface BuyerRisk {
  level: "low" | "elevated" | "high";
  score: number;
  signals: BuyerSignal[];
}

export const HIGH_VALUE_KOPECKS = 20_000_00;

export function assessBuyerRisk(h: BuyerHistory, current: CurrentDispute): BuyerRisk {
  const signals: BuyerSignal[] = [];
  const add = (code: string, weight: number, text: string) => signals.push({ code, weight, text });

  if (current.reason === "ITEM_NOT_RECEIVED" && current.carrierDelivered) {
    add("NOT_RECEIVED_BUT_DELIVERED", 2, "Покупатель пишет, что не получил заказ, а перевозчик отметил вручение. Запросите у службы доставки подтверждение (подпись, код, фото)");
  }
  if (h.notReceivedButDelivered >= 2) {
    add("REPEATED_NOT_RECEIVED", 3, `За 90 дней уже ${h.notReceivedButDelivered} раза «не получил» при отметке о вручении`);
  }
  const rate = h.ordersLast90 > 0 ? h.disputesLast90 / h.ordersLast90 : 1;
  if (h.disputesLast90 >= 5 && rate >= 0.5) {
    add("SERIAL_DISPUTES", 3, `Споры по ${h.disputesLast90} из ${h.ordersLast90} заказов за 90 дней`);
  } else if (h.disputesLast90 >= 3 && rate >= 0.3) {
    add("FREQUENT_DISPUTES", 2, `Споры по ${h.disputesLast90} из ${h.ordersLast90} заказов за 90 дней`);
  }
  if (h.refundsLast90 >= 3 && h.ordersLast90 > 0 && h.refundsLast90 / h.ordersLast90 >= 0.4) {
    add("FREQUENT_REFUNDS", 2, `Возвраты денег по ${h.refundsLast90} из ${h.ordersLast90} заказов за 90 дней`);
  }
  if (h.disputesWonLast90 >= 3 && h.distinctSellersInDisputes >= 3) {
    add("WINS_ACROSS_SELLERS", 1, `Выиграл ${h.disputesWonLast90} спора у ${h.distinctSellersInDisputes} разных продавцов за 90 дней`);
  }
  if (h.accountAgeDays < 7 && current.orderTotalKopecks >= HIGH_VALUE_KOPECKS) {
    add("NEW_ACCOUNT_HIGH_VALUE", 1, "Новый аккаунт открыл спор по дорогому заказу");
  }

  const score = signals.reduce((s, x) => s + x.weight, 0);
  const level: BuyerRisk["level"] = score >= 4 ? "high" : score >= 2 ? "elevated" : "low";
  return { level, score, signals };
}

export function explainBuyerRisk(r: BuyerRisk): string {
  return r.signals.map((s) => s.text).join(". ");
}
