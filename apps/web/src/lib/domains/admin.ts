/**
 * Admin observability + moderation (spec §37, §92, §140).
 *
 * Every view is read-only aggregation over authoritative tables. The admin
 * surface never mutates money, verification or order state directly from a
 * listing — write actions go through the same audited domain services the
 * buyers/sellers use, so there is one code path and one audit trail.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { fromKopecks } from "../utils";

export interface AdminOverview {
  users: { total: number; buyers: number; sellers: number; blocked: number };
  products: { total: number; active: number; aiDraft: number };
  orders: { total: number; byStatus: Record<string, number> };
  payments: { grossKopecks: number; platformFeeKopecks: number };
  reviews: { total: number; hidden: number };
  risk: { openEvents: number; byLevel: Record<string, number> };
  verification: { pendingSellers: number; verifiedSellers: number };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [
    userCounts,
    blocked,
    productCounts,
    productActive,
    aiDraft,
    orderStatuses,
    paymentAgg,
    feeAgg,
    reviewCounts,
    reviewHidden,
    riskOpen,
    riskLevels,
    pendingSellers,
    verifiedSellers,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { isBlocked: true } }),
    prisma.product.count(),
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.product.count({ where: { aiDraft: true } }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.payment.aggregate({ _sum: { amountKopecks: true }, where: { status: "SUCCEEDED" } }),
    // Platform fee is settled per order (spec §26) — sum it from the source of truth.
    prisma.settlement.aggregate({ _sum: { platformFeeKopecks: true } }),
    prisma.review.count(),
    prisma.review.count({ where: { isHidden: true } }),
    prisma.riskEvent.count({ where: { reviewedAt: null } }),
    prisma.riskEvent.groupBy({
      by: ["level"],
      _count: { _all: true },
      where: { reviewedAt: null },
    }),
    prisma.sellerProfile.count({ where: { isActivated: true, identityStatus: "PENDING" } }),
    prisma.sellerProfile.count({ where: { identityStatus: "VERIFIED" } }),
  ]);

  const users = { total: 0, buyers: 0, sellers: 0, blocked };
  for (const g of userCounts) {
    users.total += g._count._all;
    if (g.role === "BUYER") users.buyers = g._count._all;
    if (g.role === "SELLER") users.sellers = g._count._all;
  }

  const byStatus: Record<string, number> = {};
  for (const g of orderStatuses) byStatus[g.status] = g._count._all;

  const byLevel: Record<string, number> = {};
  for (const g of riskLevels) byLevel[g.level] = g._count._all;

  return {
    users,
    products: { total: productCounts, active: productActive, aiDraft },
    orders: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
    payments: {
      grossKopecks: paymentAgg._sum.amountKopecks ?? 0,
      platformFeeKopecks: feeAgg._sum.platformFeeKopecks ?? 0,
    },
    reviews: { total: reviewCounts, hidden: reviewHidden },
    risk: { openEvents: riskOpen, byLevel },
    verification: { pendingSellers, verifiedSellers },
  };
}

export async function listAdminUsers(limit = 50) {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isBlocked: true,
      createdAt: true,
      sellerProfile: { select: { id: true, displayName: true, identityStatus: true } },
    },
  });
  return users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    seller: u.sellerProfile
      ? {
          id: u.sellerProfile.id,
          displayName: u.sellerProfile.displayName,
          identityStatus: u.sellerProfile.identityStatus,
        }
      : null,
    sellerProfile: undefined,
  }));
}

export async function listAdminOrders(limit = 50) {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      number: true,
      status: true,
      totalKopecks: true,
      createdAt: true,
      buyer: { select: { id: true, name: true, email: true } },
      sellerProfile: { select: { id: true, displayName: true } },
      payment: { select: { status: true, provider: true, sandbox: true } },
      shipment: { select: { status: true, carrierName: true, sandbox: true } },
    },
  });
  return orders.map((o) => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    totalRub: fromKopecks(o.totalKopecks),
    payment: o.payment ?? null,
    shipment: o.shipment ?? null,
  }));
}

export async function listVerificationQueue(limit = 50) {
  const sellers = await prisma.sellerProfile.findMany({
    where: { isActivated: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      displayName: true,
      sellerType: true,
      slug: true,
      identityStatus: true,
      businessStatus: true,
      npdStatus: true,
      inn: true,
      ogrn: true,
      createdAt: true,
      _count: { select: { verificationRecords: true, documents: true } },
    },
  });
  return sellers.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));
}

export async function listRiskEvents(limit = 50) {
  const events = await prisma.riskEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actorType: true,
      actorId: true,
      level: true,
      ruleId: true,
      description: true,
      actionTaken: true,
      reviewedAt: true,
      createdAt: true,
    },
  });
  return events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
}

export async function listAuditLog(limit = 100) {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actorId: true,
      actorRole: true,
      action: true,
      targetType: true,
      targetId: true,
      createdAt: true,
    },
  });
  return logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }));
}

// ---------------------------------------------------------------------------
// Admin decision actions (spec §140).
//
// These are the only writes the admin surface performs. Each one snapshots
// before/after into the audit log so an administrator's every sensitive action
// is reviewable. Money, payouts and document validity are deliberately NOT
// mutated here — those stay with their regulated/audited domain services.
// ---------------------------------------------------------------------------

export async function setUserBlocked(
  userId: string,
  blocked: boolean,
  actorId: string
): Promise<{ id: string; isBlocked: boolean }> {
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, isBlocked: true, role: true },
  });
  if (before.role === "ADMIN") {
    throw new Error("Нельзя заблокировать администратора");
  }
  if (before.isBlocked === blocked) return before;

  const after = await prisma.user.update({
    where: { id: userId },
    data: { isBlocked: blocked },
    select: { id: true, isBlocked: true },
  });

  await audit({
    actorId,
    actorRole: "admin",
    action: blocked ? "user_blocked" : "user_unblocked",
    targetType: "User",
    targetId: userId,
    before: { isBlocked: before.isBlocked },
    after: { isBlocked: after.isBlocked },
  });
  return after;
}

export async function reviewRiskEvent(
  riskEventId: string,
  decision: string,
  actorId: string
): Promise<{ id: string; reviewedAt: Date | null }> {
  const before = await prisma.riskEvent.findUniqueOrThrow({
    where: { id: riskEventId },
    select: { id: true, level: true, ruleId: true, reviewedAt: true, actorId: true },
  });
  // An event may only be reviewed once; a replay is a no-op, not an error,
  // so a double-click does not create duplicate audit entries.
  if (before.reviewedAt) return before;

  const after = await prisma.riskEvent.update({
    where: { id: riskEventId },
    data: {
      reviewedAt: new Date(),
      reviewedBy: actorId,
      actionTaken: decision,
    },
    select: { id: true, reviewedAt: true },
  });

  await audit({
    actorId,
    actorRole: "admin",
    action: "risk_event_reviewed",
    targetType: "RiskEvent",
    targetId: riskEventId,
    before: { level: before.level, ruleId: before.ruleId, reviewedAt: before.reviewedAt },
    after: { decision, reviewedAt: after.reviewedAt },
  });
  return after;
}

/**
 * Administrative verification decision. This is a *manual review* outcome and
 * is recorded with source=manual_review so it is never confused with an
 * official ESIA/FNS check (spec §49: no fake verification).
 */
export async function decideVerification(
  sellerId: string,
  kind: string,
  approved: boolean,
  note: string | undefined,
  actorId: string
): Promise<{ sellerId: string; kind: string; status: string }> {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({
    where: { id: sellerId },
    select: { id: true, identityStatus: true, inn: true },
  });

  const status = approved ? "VERIFIED" : "REJECTED";
  const record = await prisma.verificationRecord.create({
    data: {
      sellerId,
      kind,
      status,
      source: "manual_review",
      note: note?.slice(0, 500),
      verifiedAt: approved ? new Date() : null,
    },
  });

  // A manual identity approval lifts the seller's identity status; a rejection
  // records the decision but still leaves the seller unverified.
  if (approved && kind === "identity" && seller.identityStatus !== "VERIFIED") {
    await prisma.sellerProfile.update({
      where: { id: sellerId },
      data: { identityStatus: "VERIFIED" },
    });
  }

  await audit({
    actorId,
    actorRole: "admin",
    action: approved ? "verification_approved" : "verification_rejected",
    targetType: "SellerProfile",
    targetId: sellerId,
    before: { identityStatus: seller.identityStatus },
    after: { recordId: record.id, kind, status, source: "manual_review" },
  });
  return { sellerId, kind, status };
}

export async function listAiModelCalls(limit = 100) {
  const calls = await prisma.aiModelCall.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      traceId: true,
      provider: true,
      model: true,
      taskClass: true,
      status: true,
      latencyMs: true,
      tokensIn: true,
      tokensOut: true,
      dataClass: true,
      agentName: true,
      createdAt: true,
    },
  });
  return calls.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
}

export async function getAiCallStats() {
  const rows = await prisma.aiModelCall.groupBy({
    by: ["provider", "status"],
    _count: { _all: true },
    _avg: { latencyMs: true },
    _sum: { tokensIn: true, tokensOut: true },
  });
  return rows.map((r) => ({
    provider: r.provider,
    status: r.status,
    calls: r._count._all,
    avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
    tokensIn: r._sum.tokensIn ?? 0,
    tokensOut: r._sum.tokensOut ?? 0,
  }));
}
