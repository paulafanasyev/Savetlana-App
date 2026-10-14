/**
 * Что покупатель видит о продавце: отметки проверки и рейтинг.
 *
 * Чистые функции, только по фактам из базы. Отметка ставится, когда проверку
 * провёл официальный источник (ФНС, Госуслуги) или модератор; рейтинг считается
 * только по реальным заказам и отзывам.
 */

export interface SellerBadge {
  key: "verified_seller" | "npd_fns" | "business" | "identity";
  label: string;
  hint: string;
}

export function sellerBadges(s: { sellerType: string; identityStatus: string; businessStatus: string; npdStatus: string }): SellerBadge[] {
  const identity = s.identityStatus === "VERIFIED";
  const npd = s.npdStatus === "VERIFIED";
  const business = s.businessStatus === "VERIFIED";
  const badges: SellerBadge[] = [];
  if (identity && (npd || business)) {
    badges.push({ key: "verified_seller", label: "Проверенный продавец", hint: "Личность и налоговый статус подтверждены" });
  }
  if (npd) badges.push({ key: "npd_fns", label: "Самозанятый, подтверждено ФНС", hint: "Статус плательщика НПД проверен в сервисе ФНС" });
  if (business) {
    badges.push({ key: "business", label: s.sellerType === "COMPANY" ? "Организация подтверждена" : "ИП подтверждён", hint: "Регистрация проверена по данным ЕГРЮЛ/ЕГРИП" });
  }
  if (identity) badges.push({ key: "identity", label: "Личность подтверждена", hint: "Через Госуслуги или проверку документов" });
  return badges;
}

export interface RatingInput {
  /** Сумма и число оценок с подтверждённой покупкой. */
  verifiedSum: number;
  verifiedCount: number;
  /** Сумма и число остальных оценок (весят вдвое меньше). */
  otherSum: number;
  otherCount: number;
  completedOrders: number;
  /** Отменены уже после оплаты: покупатель ждал и не получил. */
  cancelledAfterPayment: number;
  refundedOrders: number;
  disputedOrders: number;
}

export interface SellerRating {
  /** Оценка 1–5 с поправкой на малое число отзывов. */
  score: number;
  /** Простое среднее по отзывам, как привыкли видеть покупатели. */
  average: number;
  reviewsCount: number;
  /** Доля успешных сделок 0–1 или null, если заказов мало. */
  successRate: number | null;
  level: "new" | "trusted" | "good" | "normal" | "complaints";
  levelLabel: string;
}

const PRIOR = 4.0;
const PRIOR_WEIGHT = 5;

/**
 * Байесовское среднее: у нового продавца с одним отзывом «5» рейтинг не
 * взлетает до 5.0, а у опытного почти совпадает с обычным средним.
 */
export function computeSellerRating(i: RatingInput): SellerRating {
  const weightedCount = i.verifiedCount + i.otherCount * 0.5;
  const weightedSum = i.verifiedSum + i.otherSum * 0.5;
  const reviewsCount = i.verifiedCount + i.otherCount;
  const average = reviewsCount > 0 ? (i.verifiedSum + i.otherSum) / reviewsCount : 0;
  const score = weightedCount > 0 ? (PRIOR * PRIOR_WEIGHT + weightedSum) / (PRIOR_WEIGHT + weightedCount) : 0;
  const finished = i.completedOrders + i.cancelledAfterPayment + i.refundedOrders + i.disputedOrders;
  const successRate = finished >= 3 ? i.completedOrders / finished : null;

  // Жалобы важнее «новичка»: срыв сделок видно сразу. Одна плохая оценка
  // ещё не жалобы, нужно хотя бы три отзыва.
  let level: SellerRating["level"] = "normal";
  if ((reviewsCount >= 3 && score < 3.5) || (successRate !== null && successRate < 0.8)) level = "complaints";
  else if (i.completedOrders < 3) level = "new";
  else if (score >= 4.7 && (successRate ?? 0) >= 0.95 && i.completedOrders >= 20) level = "trusted";
  else if (score >= 4.3 && (successRate ?? 0) >= 0.9 && i.completedOrders >= 5) level = "good";

  const LABELS: Record<SellerRating["level"], string> = {
    new: "Новый продавец",
    trusted: "Надёжный продавец",
    good: "Хороший продавец",
    normal: "Продавец",
    complaints: "Есть жалобы покупателей",
  };
  return {
    score: Math.round(score * 10) / 10,
    average: Math.round(average * 10) / 10,
    reviewsCount,
    successRate: successRate === null ? null : Math.round(successRate * 100) / 100,
    level,
    levelLabel: LABELS[level],
  };
}
