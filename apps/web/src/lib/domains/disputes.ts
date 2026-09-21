/**
 * Dispute Center (spec §42).
 *
 * Svetlana collects evidence and timelines, but she does not issue legally
 * binding verdicts — a dispute that requires a judgement is escalated to a
 * human (spec §91). Every status change is journaled.
 */
import { prisma } from "../prisma";
import { parseEnum } from "../db/enums";
import { readStringArray } from "../db/json";
import { audit } from "./audit";

export type DisputeStatus =
  | "OPEN"
  | "EVIDENCE_COLLECTION"
  | "RESOLVED_BUYER"
  | "RESOLVED_SELLER"
  | "ESCALATED_HUMAN"
  | "CLOSED";

export type DisputeReason =
  | "ITEM_NOT_RECEIVED"
  | "ITEM_NOT_AS_DESCRIBED"
  | "ITEM_DAMAGED"
  | "PAYMENT_DISPUTE"
  | "RETURN_DISPUTE"
  | "DELIVERY_DISPUTE";

const TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  OPEN: ["EVIDENCE_COLLECTION", "ESCALATED_HUMAN", "CLOSED"],
  EVIDENCE_COLLECTION: ["RESOLVED_BUYER", "RESOLVED_SELLER", "ESCALATED_HUMAN"],
  RESOLVED_BUYER: ["CLOSED"],
  RESOLVED_SELLER: ["CLOSED"],
  ESCALATED_HUMAN: ["RESOLVED_BUYER", "RESOLVED_SELLER", "CLOSED"],
  CLOSED: [],
};

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface CreateDisputeInput {
  orderId: string;
  buyerId: string;
  reason: DisputeReason;
  description: string;
  evidenceUrls?: string[];
}

export async function openDispute(input: CreateDisputeInput) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, buyerId: input.buyerId },
    include: { items: true },
  });
  if (!order) throw new Error("заказ не найден");

  const sellerId = order.sellerId;
  if (!sellerId) throw new Error("у заказа нет продавца");

  const existing = await prisma.dispute.findFirst({
    where: { orderId: input.orderId, status: { not: "CLOSED" } },
  });
  if (existing) throw new Error("по этому заказу уже открыт спор");

  const dispute = await prisma.dispute.create({
    data: {
      orderId: input.orderId,
      buyerId: input.buyerId,
      sellerId,
      reason: input.reason,
      status: "OPEN",
      description: input.description.slice(0, 4000),
      evidenceUrls: JSON.stringify(input.evidenceUrls ?? []),
    },
  });
  await audit({
    actorId: input.buyerId,
    actorRole: "buyer",
    action: "dispute.opened",
    targetType: "dispute",
    targetId: dispute.id,
    after: { reason: input.reason, orderId: input.orderId },
  });
  return dispute;
}

/**
 * Svetlana gathers verifiable facts: tracking events, payment status, order
 * timeline, review history. Each fact is labelled VERIFIED / NOT_PROVEN /
 * PENDING depending on the authoritative source (spec §47, §123).
 */
export async function collectEvidence(disputeId: string, actorId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      order: {
        include: {
          payment: true,
          shipment: { include: { events: true } },
          history: true,
        },
      },
    },
  });
  if (!dispute) throw new Error("спор не найден");

  const facts: { claim: string; verification: "VERIFIED" | "NOT_PROVEN" | "PENDING"; source: string }[] = [];

  const payment = dispute.order.payment;
  facts.push({
    claim: payment
      ? `Оплата по заказу: ${payment.status}`
      : "Платёж по заказу не найден",
    verification: payment ? "VERIFIED" : "NOT_PROVEN",
    source: payment ? "payment provider record" : "payment table",
  });

  const shipment = dispute.order.shipment;
  if (shipment) {
    const delivered = shipment.events.some((e) => e.status === "DELIVERED");
    facts.push({
      claim: delivered
        ? `Отметка о доставке от перевозчика ${shipment.carrierName}`
        : `Доставка не завершена, последний статус: ${shipment.status}`,
      verification: delivered ? "VERIFIED" : "PENDING",
      source: "carrier tracking API",
    });
  } else {
    facts.push({
      claim: "Отправление не создавалось",
      verification: "VERIFIED",
      source: "shipment table",
    });
  }

  await prisma.dispute.update({
    where: { id: disputeId },
    data: { status: "EVIDENCE_COLLECTION", requiresHuman: true },
  });
  await audit({
    actorId,
    actorRole: "system",
    action: "dispute.evidence_collected",
    targetType: "dispute",
    targetId: disputeId,
    after: { facts },
  });
  return { facts, requiresHuman: true };
}

export async function transitionDispute(
  disputeId: string,
  actorId: string,
  actorRole: string,
  to: DisputeStatus,
  resolution?: string
) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw new Error("спор не найден");
  const from = parseEnum<DisputeStatus>("DisputeStatus", dispute.status, "OPEN");
  if (from === to) return dispute;
  if (!canTransitionDispute(from, to)) {
    throw new Error(`недопустимый переход статуса спора: ${from} → ${to}`);
  }
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: { status: to, resolution: resolution?.slice(0, 4000) },
  });
  await audit({
    actorId,
    actorRole,
    action: "dispute.status_changed",
    targetType: "dispute",
    targetId: disputeId,
    before: { status: from },
    after: { status: to, resolution },
  });
  return updated;
}

export async function listDisputesForUser(userId: string) {
  return prisma.dispute.findMany({
    where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    orderBy: { createdAt: "desc" },
  });
}

export function evidenceUrls(dispute: { evidenceUrls: string }): string[] {
  return readStringArray(dispute.evidenceUrls);
}
