/**
 * Сигналы злоупотребления спорами и возвратами по данным из базы.
 * Решение по спору всегда за человеком; здесь только факты для модератора.
 * Покупателю эти сигналы не показываются.
 */
import { prisma } from "../prisma";
import { assessBuyerRisk, explainBuyerRisk, type BuyerHistory, type BuyerRisk } from "./buyer-abuse";

const DAY = 24 * 60 * 60 * 1000;
const NOT_PAID = ["CREATED", "PAYMENT_PENDING"];

const deliveredShipment = {
  is: { OR: [{ status: "DELIVERED" }, { events: { some: { status: "DELIVERED" } } }] },
};

export async function loadBuyerHistory(buyerId: string, now = new Date()): Promise<BuyerHistory> {
  const since = new Date(now.getTime() - 90 * DAY);
  const [user, ordersLast90, disputes, refundsLast90, notReceivedButDelivered] = await Promise.all([
    prisma.user.findUnique({ where: { id: buyerId }, select: { createdAt: true } }),
    prisma.order.count({ where: { buyerId, createdAt: { gte: since }, status: { notIn: NOT_PAID } } }),
    prisma.dispute.findMany({
      where: { buyerId, createdAt: { gte: since } },
      select: { sellerId: true, status: true, refundId: true },
      take: 500,
    }),
    prisma.refund.count({ where: { createdAt: { gte: since }, payment: { is: { buyerId } } } }),
    prisma.dispute.count({
      where: { buyerId, createdAt: { gte: since }, reason: "ITEM_NOT_RECEIVED", order: { shipment: deliveredShipment } },
    }),
  ]);
  return {
    accountAgeDays: user ? Math.floor((now.getTime() - user.createdAt.getTime()) / DAY) : 0,
    ordersLast90,
    disputesLast90: disputes.length,
    disputesWonLast90: disputes.filter((d) => d.status === "RESOLVED_BUYER" || d.refundId).length,
    distinctSellersInDisputes: new Set(disputes.map((d) => d.sellerId)).size,
    refundsLast90,
    notReceivedButDelivered,
  };
}

/** Оценка риска по конкретному спору: история покупателя и факты доставки. */
export async function assessDisputeBuyer(disputeId: string): Promise<BuyerRisk | null> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: {
      buyerId: true,
      reason: true,
      order: {
        select: {
          totalKopecks: true,
          shipment: { select: { status: true, events: { where: { status: "DELIVERED" }, select: { id: true }, take: 1 } } },
        },
      },
    },
  });
  if (!dispute) return null;
  const shipment = dispute.order.shipment;
  const history = await loadBuyerHistory(dispute.buyerId);
  return assessBuyerRisk(history, {
    reason: dispute.reason,
    orderTotalKopecks: dispute.order.totalKopecks,
    carrierDelivered: Boolean(shipment && (shipment.status === "DELIVERED" || shipment.events.length > 0)),
  });
}

/**
 * Вызывается при открытии спора: при заметном риске спор помечается как
 * требующий человека, а в журнал рисков пишется объяснение.
 */
export async function screenNewDispute(disputeId: string): Promise<BuyerRisk | null> {
  const risk = await assessDisputeBuyer(disputeId);
  if (!risk || risk.level === "low") return risk;
  const dispute = await prisma.dispute.update({
    where: { id: disputeId },
    data: { requiresHuman: true },
    select: { buyerId: true, orderId: true },
  });
  await prisma.riskEvent.create({
    data: {
      actorType: "user",
      actorId: dispute.buyerId,
      level: risk.level === "high" ? "HIGH" : "REVIEW",
      ruleId: risk.level === "high" ? "D2_dispute_abuse_high" : "D1_dispute_abuse_signals",
      description: "признаки злоупотребления спорами или возвратами",
      signals: JSON.stringify({ disputeId, orderId: dispute.orderId, codes: risk.signals.map((s) => s.code), score: risk.score }),
      explanation: explainBuyerRisk(risk),
      actionTaken: "manual_review",
    },
  });
  return risk;
}
