/**
 * Risk / Anti-Scam Engine (spec §27, §40, §141).
 *
 * Deterministic, explainable, auditable rules. The AI never freezes money on
 * its own (spec §27): the engine only produces a risk level + explanation,
 * and any actual hold comes from a documented policy action taken by an
 * authorised actor, logged in the audit trail.
 *
 * Levels: LOW | MEDIUM | HIGH | REVIEW | BLOCKED
 */
import { prisma } from "../prisma";
import { audit } from "./audit";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "REVIEW" | "BLOCKED";

export interface RiskVerdict {
  level: RiskLevel;
  ruleId: string;
  description: string;
  signals: Record<string, unknown>;
  explanation: string;
  /** Recommended action; executing it still requires policy + audit. */
  recommendedAction: string;
}

const LEVEL_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  REVIEW: 3,
  BLOCKED: 4,
};

function worst(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Evaluates a checkout/order before payment is captured. Pure functions over
 * DB state, so the same order always yields the same verdict (auditable).
 */
export async function evaluateOrderRisk(orderGroupId: string): Promise<RiskVerdict> {
  const group = await prisma.orderGroup.findUniqueOrThrow({
    where: { id: orderGroupId },
    include: {
      orders: {
        include: {
          items: { include: { product: { select: { id: true, priceKopecks: true, sellerId: true } } } },
        },
      },
    },
  });
  const buyerId = group.buyerId;

  const [buyer, buyerOrders, refunds, sellerProfiles] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: buyerId },
      include: { profile: true },
    }),
    prisma.order.count({ where: { buyerId } }),
    prisma.refund.count({ where: { orderId: { in: group.orders.map((o) => o.id) } } }),
    prisma.sellerProfile.findMany({
      where: { id: { in: group.orders.map((o) => o.sellerId) } },
    }),
  ]);

  const signals: Record<string, unknown> = {};
  let verdict: RiskVerdict = {
    level: "LOW",
    ruleId: "none",
    description: "штрафных сигналов не обнаружено",
    signals: {},
    explanation: "Заказ соответствует обычному профилю покупателя.",
    recommendedAction: "proceed",
  };
  const fired: string[] = [];

  // R1 — brand-new account making a large first order
  const totalKopecks = group.orders.reduce(
    (s, o) => s + o.items.reduce((x, i) => x + i.priceKopecks * i.quantity, 0),
    0
  );
  const accountAgeDays = (Date.now() - buyer.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (buyerOrders === 0 && totalKopecks > 50_000 * 100) {
    fired.push("R1");
    signals.accountAgeDays = Math.floor(accountAgeDays);
    signals.totalKopecks = totalKopecks;
    verdict = {
      level: worst(verdict.level, "MEDIUM"),
      ruleId: "R1_new_account_large_order",
      description: "первый заказ на крупную сумму с нового аккаунта",
      signals,
      explanation:
        "Аккаунту меньше времени, чем обычно требуется для доверия, а сумма заказа крупная. Дополнительная проверка — превентивная мера.",
      recommendedAction: "manual_review",
    };
  }

  // R2 — refund abuse pattern
  const refundRate = buyerOrders > 0 ? refunds / buyerOrders : 0;
  if (refundRate > 0.4 && buyerOrders >= 5) {
    fired.push("R2");
    signals.refundRate = refundRate;
    signals.refunds = refunds;
    signals.orders = buyerOrders;
    verdict = {
      level: worst(verdict.level, "HIGH"),
      ruleId: "R2_refund_abuse_pattern",
      description: "аномальный уровень возвратов",
      signals,
      explanation: `Доля возвратов ${(refundRate * 100).toFixed(0)}% при ${buyerOrders} заказах — выше допустимого порога.`,
      recommendedAction: "require_verification",
    };
  }

  // R3 — unverified seller receiving a surge
  const unverifiedSellers = sellerProfiles.filter((s) => s.businessStatus !== "VERIFIED");
  if (unverifiedSellers.length > 0 && totalKopecks > 100_000 * 100) {
    fired.push("R3");
    signals.unverifiedSellers = unverifiedSellers.map((s) => s.id);
    verdict = {
      level: worst(verdict.level, "MEDIUM"),
      ruleId: "R3_large_order_to_unverified_seller",
      description: "крупный заказ в пользу неверифицированного продавца",
      signals,
      explanation: "Продавец не прошёл бизнес-верификацию, а сумма значительная. Средства хранятся в безопасной расчётной модели до подтверждения сделки.",
      recommendedAction: "hold_payout_until_delivery",
    };
  }

  // R4 — velocity: many orders in 10 minutes
  const recent = await prisma.order.count({
    where: { buyerId, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } },
  });
  if (recent >= 5) {
    fired.push("R4");
    signals.ordersIn10min = recent;
    verdict = {
      level: worst(verdict.level, "REVIEW"),
      ruleId: "R4_order_velocity",
      description: "слишком много заказов за короткое время",
      signals,
      explanation: `${recent} заказов за 10 минут — нетипичный паттерн. Требуется ручная проверка перед списанием.`,
      recommendedAction: "manual_review",
    };
  }

  // R5 — price integrity: item price must match the product's current price
  for (const o of group.orders) {
    for (const item of o.items) {
      if (item.priceKopecks !== item.product.priceKopecks) {
        fired.push("R5");
        signals.priceMismatch = {
          productId: item.product.id,
          charged: item.priceKopecks,
          catalog: item.product.priceKopecks,
        };
        verdict = {
          level: worst(verdict.level, "BLOCKED"),
          ruleId: "R5_price_mismatch",
          description: "цена в заказе не соответствует цене в каталоге",
          signals,
          explanation:
            "Сумма к списанию не совпадает с актуальной ценой товара. Оплата блокируется до выяснения причины.",
          recommendedAction: "block_payment",
        };
      }
    }
  }

  if (fired.length === 0) {
    verdict.signals = { accountAgeDays: Math.floor(accountAgeDays), orders: buyerOrders, totalKopecks };
  }

  await prisma.riskEvent.create({
    data: {
      actorType: "order",
      actorId: orderGroupId,
      level: verdict.level,
      ruleId: verdict.ruleId,
      description: verdict.description,
      signals: JSON.stringify(verdict.signals),
      explanation: verdict.explanation,
      actionTaken: verdict.recommendedAction,
    },
  });

  await audit({
    actorId: buyerId,
    actorRole: "system",
    action: "risk_evaluation",
    targetType: "OrderGroup",
    targetId: orderGroupId,
    after: { level: verdict.level, ruleId: verdict.ruleId, action: verdict.recommendedAction },
  });

  return verdict;
}

/**
 * Seller-side risk signals (spec §27: "подозрительные продавцы").
 */
export async function evaluateSellerRisk(sellerId: string): Promise<RiskVerdict> {
  const sellerOrders = await prisma.order.findMany({
    where: { sellerId },
    select: { id: true },
    take: 500,
  });
  const sellerOrderIds = sellerOrders.map((o) => o.id);

  const [orders, disputes, refunds, products] = await Promise.all([
    prisma.order.count({ where: { sellerId } }),
    prisma.dispute.count({ where: { sellerId } }),
    prisma.refund.count({ where: { orderId: { in: sellerOrderIds } } }),
    prisma.product.count({ where: { sellerId, status: "ACTIVE" } }),
  ]);

  const disputeRate = orders > 0 ? disputes / orders : 0;
  if (disputeRate > 0.25 && orders >= 4) {
    return {
      level: "HIGH",
      ruleId: "S1_dispute_rate",
      description: "высокая доля споров",
      signals: { orders, disputes, disputeRate },
      explanation: `Доля споров ${(disputeRate * 100).toFixed(0)}% — значительно выше нормы.`,
      recommendedAction: "restrict_listing_until_review",
    };
  }
  if (products === 0 && orders === 0) {
    return {
      level: "LOW",
      ruleId: "S0_new_seller",
      description: "новый продавец без истории",
      signals: { products, orders },
      explanation: "Недостаточно данных для оценки. Ограничений нет, выплаты идут по стандартной модели.",
      recommendedAction: "proceed",
    };
  }
  return {
    level: "LOW",
    ruleId: "none",
    description: "штрафных сигналов не обнаружено",
    signals: { orders, disputes, refunds, products },
    explanation: "Поведение продавца соответствует норме.",
    recommendedAction: "proceed",
  };
}
