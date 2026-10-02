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
      history: {
        create: {
          actorId: input.buyerId,
          action: "dispute_opened",
          toStatus: "OPEN",
          note: input.reason,
        },
      },
    },
    include: { history: true },
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
  await startSellerSla(disputeId);
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

// =============================================================================
// Dispute Case System (audit §32)
// =============================================================================

const SLA_DAYS = 3;

export async function appendMessage(
  disputeId: string,
  authorId: string,
  authorRole: "buyer" | "seller" | "admin" | "support",
  body: string,
  isInternal = false
) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { sellerProfile: { select: { userId: true } } },
  });
  if (!dispute) throw new Error("спор не найден");
  if (dispute.status === "CLOSED") throw new Error("спор закрыт, сообщения запрещены");
  if (authorRole === "buyer" && dispute.buyerId !== authorId) throw new Error("нет доступа");
  // The dispute stores the seller *profile* id; the acting user owns that profile.
  if (authorRole === "seller" && dispute.sellerProfile.userId !== authorId) {
    throw new Error("нет доступа");
  }
  if (isInternal && authorRole !== "admin" && authorRole !== "support") {
    throw new Error("внутренние заметки доступны только модерации");
  }

  const [msg] = await prisma.$transaction([
    prisma.disputeMessage.create({
      data: {
        disputeId,
        authorId,
        authorRole,
        body: body.slice(0, 4000),
        isInternal,
      },
    }),
    prisma.disputeHistory.create({
      data: {
        disputeId,
        actorId: authorId,
        action: isInternal ? "internal_note" : "message",
        note: body.slice(0, 200),
      },
    }),
    prisma.dispute.update({ where: { id: disputeId }, data: { updatedAt: new Date() } }),
  ]);
  return msg;
}

export async function attachEvidence(
  disputeId: string,
  uploadedById: string,
  params: {
    kind: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  }
) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw new Error("спор не найден");
  if (dispute.buyerId !== uploadedById && dispute.sellerId !== uploadedById) {
    throw new Error("только участники спора могут прикреплять доказательства");
  }
  if (params.sizeBytes > 25 * 1024 * 1024) throw new Error("файл превышает 25 МБ");

  const ev = await prisma.disputeEvidence.create({
    data: {
      disputeId,
      uploadedById,
      kind: params.kind,
      storageKey: params.storageKey,
      fileName: params.fileName.slice(0, 255),
      mimeType: params.mimeType.slice(0, 100),
      sizeBytes: params.sizeBytes,
      contentHash: params.contentHash,
      verified: false,
    },
  });
  await prisma.disputeHistory.create({
    data: {
      disputeId,
      actorId: uploadedById,
      action: "evidence_attached",
      note: params.fileName.slice(0, 200),
    },
  });
  return ev;
}

export async function markEvidenceVerified(evidenceId: string) {
  return prisma.disputeEvidence.update({
    where: { id: evidenceId },
    data: { verified: true },
  });
}

export async function assignAdmin(disputeId: string, adminId: string) {
  const dispute = await prisma.dispute.update({
    where: { id: disputeId },
    data: { assignedAdminId: adminId },
  });
  await prisma.disputeHistory.create({
    data: { disputeId, actorId: adminId, action: "assigned", note: "назначен модератор" },
  });
  await audit({
    actorId: adminId,
    actorRole: "admin",
    action: "dispute.assigned",
    targetType: "dispute",
    targetId: disputeId,
    after: { adminId },
  });
  return dispute;
}

/**
 * Seller response SLA: starts when the dispute reaches EVIDENCE_COLLECTION.
 * A breach is recorded (never auto-ruled — a human still decides, spec §42).
 */
export async function startSellerSla(disputeId: string) {
  const until = new Date(Date.now() + SLA_DAYS * 24 * 60 * 60 * 1000);
  await prisma.dispute.update({
    where: { id: disputeId },
    data: { sellerSlaUntil: until, slaBreached: false },
  });
  await prisma.disputeHistory.create({
    data: { disputeId, action: "sla_started", note: `${SLA_DAYS} дня на ответ продавца` },
  });
  return until;
}

export async function checkSlaBreaches() {
  const breached = await prisma.dispute.findMany({
    where: {
      sellerSlaUntil: { lt: new Date() },
      slaBreached: false,
      status: { in: ["OPEN", "EVIDENCE_COLLECTION"] },
    },
    select: { id: true },
  });
  for (const d of breached) {
    await prisma.dispute.update({ where: { id: d.id }, data: { slaBreached: true } });
    await prisma.disputeHistory.create({
      data: { disputeId: d.id, action: "sla_breached", note: "продавец не ответил в срок" },
    });
  }
  return breached.length;
}

export async function escalateToHuman(
  disputeId: string,
  actorId: string,
  reason: string
) {
  const dispute = await transitionDispute(disputeId, actorId, "system", "ESCALATED_HUMAN", reason);
  await prisma.disputeHistory.create({
    data: { disputeId, actorId, action: "escalated", note: reason.slice(0, 500) },
  });
  return dispute;
}

/**
 * One appeal per dispute, within the appeal window. The appeal reopens the case
 * for a human — it never auto-overturns a resolution (spec §42).
 */
const APPEAL_WINDOW_DAYS = 14;

export async function fileAppeal(disputeId: string, buyerId: string, reason: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw new Error("спор не найден");
  if (dispute.buyerId !== buyerId) throw new Error("обжаловать может покупатель");
  if (dispute.appealedAt) throw new Error("апелляция уже подана");
  if (dispute.status !== "RESOLVED_SELLER" && dispute.status !== "RESOLVED_BUYER") {
    throw new Error("обжаловать можно только вынесенное решение");
  }
  const since = dispute.updatedAt ?? dispute.createdAt;
  if (Date.now() - since.getTime() > APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error("срок обжалования истёк");
  }

  const [updated] = await prisma.$transaction([
    prisma.dispute.update({
      where: { id: disputeId },
      data: {
        appealedAt: new Date(),
        appealReason: reason.slice(0, 4000),
        status: "ESCALATED_HUMAN",
      },
    }),
    prisma.disputeHistory.create({
      data: {
        disputeId,
        actorId: buyerId,
        action: "appeal_filed",
        fromStatus: dispute.status,
        toStatus: "ESCALATED_HUMAN",
        note: reason.slice(0, 200),
      },
    }),
  ]);
  await audit({
    actorId: buyerId,
    actorRole: "buyer",
    action: "dispute.appealed",
    targetType: "dispute",
    targetId: disputeId,
    after: { reason: reason.slice(0, 500) },
  });
  return updated;
}

export interface ResolveDisputeInput {
  disputeId: string;
  actorId: string;
  winner: "buyer" | "seller";
  reasonCode: string;
  resolution: string;
  refundAmountKopecks?: number;
}

/**
 * A human (admin/support) resolves the dispute. When the buyer wins, a real
 * refund is created and executed through the payment provider — never
 * fabricated (spec §49). Payout to the seller is blocked until the refund
 * settles.
 */
export async function resolveDispute(input: ResolveDisputeInput) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: input.disputeId },
    include: { order: { include: { payment: true } } },
  });
  if (!dispute) throw new Error("спор не найден");
  if (dispute.status !== "ESCALATED_HUMAN" && dispute.status !== "EVIDENCE_COLLECTION") {
    throw new Error("решение возможно только после сбора доказательств или эскалации");
  }

  const to = input.winner === "buyer" ? "RESOLVED_BUYER" : "RESOLVED_SELLER";
  let refundId: string | undefined;

  if (input.winner === "buyer") {
    const payment = dispute.order.payment;
    if (!payment) throw new Error("нельзя оформить возврат: платёж не найден");
    const amount =
      input.refundAmountKopecks ?? dispute.order.totalKopecks ?? payment.amountKopecks;
    if (amount <= 0) throw new Error("сумма возврата должна быть положительной");

    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: dispute.orderId,
        amountKopecks: amount,
        reason: input.reasonCode,
        status: "PENDING",
        payoutBlocked: true,
      },
    });
    refundId = refund.id;
  }

  await prisma.$transaction([
    prisma.dispute.update({
      where: { id: input.disputeId },
      data: {
        status: to,
        reasonCode: input.reasonCode,
        resolution: input.resolution.slice(0, 4000),
        refundId,
      },
    }),
    prisma.disputeHistory.create({
      data: {
        disputeId: input.disputeId,
        actorId: input.actorId,
        action: "resolved",
        fromStatus: dispute.status,
        toStatus: to,
        note: `${input.reasonCode}: ${input.resolution.slice(0, 150)}`,
      },
    }),
  ]);
  await audit({
    actorId: input.actorId,
    actorRole: "admin",
    action: "dispute.resolved",
    targetType: "dispute",
    targetId: input.disputeId,
    before: { status: dispute.status },
    after: { winner: input.winner, reasonCode: input.reasonCode, refundId },
  });
  return { status: to, refundId };
}

export async function getDisputeCase(disputeId: string, userId: string, role: string) {
  // Roles are stored canonically upper-case; accept either casing at the boundary.
  const normalized = role.toLowerCase();
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      order: { include: { items: true } },
      buyer: { select: { id: true, name: true } },
      sellerProfile: { select: { id: true, displayName: true, userId: true } },
      assignedAdmin: { select: { id: true, name: true } },
      messages: {
        where: normalized === "admin" || normalized === "support" ? undefined : { isInternal: false },
        orderBy: { createdAt: "asc" },
      },
      evidence: { orderBy: { createdAt: "asc" } },
      history: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!dispute) return null;
  const isParty =
    dispute.buyerId === userId || dispute.sellerProfile?.userId === userId;
  const isStaff = normalized === "admin" || normalized === "support";
  if (!isParty && !isStaff) return null;
  return dispute;
}

export async function listAdminDisputeQueue(status?: string) {
  return prisma.dispute.findMany({
    where: status ? { status } : { status: { not: "CLOSED" } },
    include: {
      buyer: { select: { id: true, name: true } },
      sellerProfile: { select: { id: true, displayName: true } },
      assignedAdmin: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}
