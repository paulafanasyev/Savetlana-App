import { prisma } from "../prisma";
import { audit } from "./audit";
import { notify } from "./notifications";
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
  const [userCounts, blocked, productCounts, productActive, aiDraft, orderStatuses, paymentAgg, feeAgg, reviewCounts, reviewHidden, riskOpen, riskLevels, pendingSellers, verifiedSellers] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }), prisma.user.count({ where: { isBlocked: true } }), prisma.product.count(), prisma.product.count({ where: { status: "ACTIVE" } }), prisma.product.count({ where: { aiDraft: true } }), prisma.order.groupBy({ by: ["status"], _count: { _all: true } }), prisma.payment.aggregate({ _sum: { amountKopecks: true }, where: { status: "SUCCEEDED" } }), prisma.settlement.aggregate({ _sum: { platformFeeKopecks: true } }), prisma.review.count(), prisma.review.count({ where: { isHidden: true } }), prisma.riskEvent.count({ where: { reviewedAt: null } }), prisma.riskEvent.groupBy({ by: ["level"], _count: { _all: true }, where: { reviewedAt: null } }), prisma.sellerProfile.count({ where: { OR: [{ isActivated: false }, { identityStatus: { not: "VERIFIED" } }, { AND: [{ businessStatus: { not: "VERIFIED" } }, { npdStatus: { not: "VERIFIED" } }] }] } }), prisma.sellerProfile.count({ where: { identityStatus: "VERIFIED", isActivated: true } }),
  ]);
  const users = { total: 0, buyers: 0, sellers: 0, blocked };
  for (const row of userCounts) { users.total += row._count._all; if (row.role === "BUYER") users.buyers = row._count._all; if (row.role === "SELLER") users.sellers = row._count._all; }
  const byStatus: Record<string, number> = {}; for (const row of orderStatuses) byStatus[row.status] = row._count._all;
  const byLevel: Record<string, number> = {}; for (const row of riskLevels) byLevel[row.level] = row._count._all;
  return { users, products: { total: productCounts, active: productActive, aiDraft }, orders: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus }, payments: { grossKopecks: paymentAgg._sum.amountKopecks ?? 0, platformFeeKopecks: feeAgg._sum.platformFeeKopecks ?? 0 }, reviews: { total: reviewCounts, hidden: reviewHidden }, risk: { openEvents: riskOpen, byLevel }, verification: { pendingSellers, verifiedSellers } };
}

export async function listAdminUsers(limit = 50) {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, email: true, name: true, role: true, isBlocked: true, createdAt: true, sellerProfile: { select: { id: true, displayName: true, identityStatus: true } } } });
  return users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), seller: u.sellerProfile ? { id: u.sellerProfile.id, displayName: u.sellerProfile.displayName, identityStatus: u.sellerProfile.identityStatus } : null, sellerProfile: undefined }));
}

export async function listAdminOrders(limit = 50) {
  const rows = await prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, number: true, status: true, totalKopecks: true, createdAt: true, buyer: { select: { id: true, name: true, email: true } }, sellerProfile: { select: { id: true, displayName: true } }, payment: { select: { status: true, provider: true, sandbox: true } }, shipment: { select: { status: true, carrierName: true, sandbox: true } } } });
  return rows.map((o) => ({ ...o, createdAt: o.createdAt.toISOString(), totalRub: fromKopecks(o.totalKopecks), payment: o.payment ?? null, shipment: o.shipment ?? null }));
}

export async function listAdminSellers(limit = 50) {
  const sellers = await prisma.sellerProfile.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, displayName: true, sellerType: true, slug: true, isActivated: true, identityStatus: true, businessStatus: true, npdStatus: true, createdAt: true, user: { select: { email: true, isBlocked: true } }, _count: { select: { products: true, orders: true } } } });
  const revenue = await prisma.order.groupBy({ by: ["sellerId"], where: { status: { in: ["PAID", "CONFIRMED", "PROCESSING", "HANDED_TO_CARRIER", "DELIVERED", "COMPLETED"] } }, _sum: { totalKopecks: true } });
  const totals = new Map(revenue.map((r) => [r.sellerId, r._sum.totalKopecks ?? 0]));
  return sellers.map((s) => ({ id: s.id, displayName: s.displayName, sellerType: s.sellerType, slug: s.slug, isActivated: s.isActivated, identityStatus: s.identityStatus, businessStatus: s.businessStatus, npdStatus: s.npdStatus, email: s.user.email, isBlocked: s.user.isBlocked, products: s._count.products, orders: s._count.orders, revenueKopecks: totals.get(s.id) ?? 0, createdAt: s.createdAt.toISOString() }));
}

export async function listAdminProducts(limit = 50) {
  const rows = await prisma.product.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, title: true, sku: true, status: true, priceKopecks: true, createdAt: true, sellerProfile: { select: { id: true, displayName: true } }, _count: { select: { reviews: true, orderItems: true } } } });
  return rows.map((p) => ({ id: p.id, title: p.title, sku: p.sku, status: p.status, priceKopecks: p.priceKopecks, sellerName: p.sellerProfile.displayName, reviews: p._count.reviews, sales: p._count.orderItems, createdAt: p.createdAt.toISOString() }));
}

export async function listAdminPayments(limit = 50) {
  const [payments, payouts] = await Promise.all([
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, orderId: true, provider: true, providerRef: true, status: true, amountKopecks: true, sandbox: true, createdAt: true, buyer: { select: { name: true } } } }),
    prisma.payout.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, sellerId: true, provider: true, providerRef: true, status: true, amountKopecks: true, createdAt: true, sellerProfile: { select: { displayName: true } } } }),
  ]);
  return { payments: payments.map((p) => ({ ...p, buyerName: p.buyer?.name ?? null, createdAt: p.createdAt.toISOString() })), payouts: payouts.map((p) => ({ ...p, sandbox: p.provider === "sandbox-payout", sellerName: p.sellerProfile.displayName, createdAt: p.createdAt.toISOString() })) };
}

export async function listVerificationQueue(limit = 50) {
  const sellers = await prisma.sellerProfile.findMany({
    where: { OR: [{ isActivated: false }, { identityStatus: { not: "VERIFIED" } }, { AND: [{ businessStatus: { not: "VERIFIED" } }, { npdStatus: { not: "VERIFIED" } }] }] },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, displayName: true, sellerType: true, slug: true, identityStatus: true, businessStatus: true, npdStatus: true, inn: true, ogrn: true, createdAt: true, _count: { select: { verificationRecords: true, documents: true } } },
  });
  return sellers.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));
}

export async function listRiskEvents(limit = 50) {
  const rows = await prisma.riskEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, actorType: true, actorId: true, level: true, ruleId: true, description: true, actionTaken: true, reviewedAt: true, createdAt: true } });
  return rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
}
export async function listAuditLog(limit = 100) {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, actorId: true, actorRole: true, action: true, targetType: true, targetId: true, createdAt: true } });
  return rows.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }));
}

export async function setUserBlocked(userId: string, blocked: boolean, actorId: string) {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, isBlocked: true, role: true } });
  if (before.role === "ADMIN") throw new Error("Нельзя заблокировать администратора");
  if (before.isBlocked === blocked) return before;
  const after = await prisma.user.update({ where: { id: userId }, data: { isBlocked: blocked }, select: { id: true, isBlocked: true } });
  await audit({ actorId, actorRole: "admin", action: blocked ? "user_blocked" : "user_unblocked", targetType: "User", targetId: userId, before: { isBlocked: before.isBlocked }, after: { isBlocked: after.isBlocked } });
  return after;
}

export async function reviewRiskEvent(riskEventId: string, decision: string, actorId: string) {
  const before = await prisma.riskEvent.findUniqueOrThrow({ where: { id: riskEventId }, select: { id: true, level: true, ruleId: true, reviewedAt: true, actorId: true } });
  if (before.reviewedAt) return before;
  const after = await prisma.riskEvent.update({ where: { id: riskEventId }, data: { reviewedAt: new Date(), reviewedBy: actorId, actionTaken: decision }, select: { id: true, reviewedAt: true } });
  await audit({ actorId, actorRole: "admin", action: "risk_event_reviewed", targetType: "RiskEvent", targetId: riskEventId, before: { level: before.level, ruleId: before.ruleId, reviewedAt: before.reviewedAt }, after: { decision, reviewedAt: after.reviewedAt } });
  return after;
}

/**
 * Продавцу: решение по заявке. Раньше он узнавал об одобрении только сам, зайдя в кабинет.
 * Уведомление дублируется письмом и в Telegram, если они подключены.
 */
async function notifySellerDecision(userId: string, approved: boolean, note: string | undefined): Promise<void> {
  await notify(
    approved
      ? {
          userId,
          kind: "document_status",
          title: "Магазин прошёл проверку",
          body: "Теперь можно публиковать товары. Карточку можно создать вместе со Светланой за пару минут.",
          url: "/seller/products",
        }
      : {
          userId,
          kind: "document_status",
          title: "Заявка продавца отклонена",
          body: `${note?.trim() ? `Причина: ${note.trim().slice(0, 300)}. ` : ""}Исправьте данные и отправьте заявку снова.`,
          url: "/seller/onboarding",
        },
  );
}

export async function decideVerification(sellerId: string, kind: string, approved: boolean, note: string | undefined, actorId: string) {
  const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerId }, select: { id: true, userId: true, identityStatus: true, businessStatus: true, npdStatus: true, isActivated: true, inn: true } });
  const status = approved ? "VERIFIED" : "REJECTED";
  const record = await prisma.verificationRecord.create({ data: { sellerId, kind, status, source: "manual_review", note: note?.slice(0, 500), verifiedAt: approved ? new Date() : null } });
  const before = { identityStatus: seller.identityStatus, businessStatus: seller.businessStatus, npdStatus: seller.npdStatus, isActivated: seller.isActivated };
  const data: { identityStatus?: string; businessStatus?: string; npdStatus?: string; isActivated?: boolean } = {};
  if (kind === "identity") data.identityStatus = status;
  if (kind === "business") data.businessStatus = status;
  if (kind === "npd") data.npdStatus = status;
  if (approved && (kind === "business" || kind === "npd")) { data.identityStatus = "VERIFIED"; data.isActivated = true; }
  if (!approved) data.isActivated = false;
  if (Object.keys(data).length) await prisma.sellerProfile.update({ where: { id: sellerId }, data });
  await audit({ actorId, actorRole: "admin", action: approved ? "verification_approved" : "verification_rejected", targetType: "SellerProfile", targetId: sellerId, before, after: { recordId: record.id, kind, status, source: "manual_review", ...data } });
  // Решение уже сохранено: сбой уведомления его не отменяет.
  if (kind === "business" || kind === "npd") await notifySellerDecision(seller.userId, approved, note).catch(() => undefined);
  return { sellerId, kind, status };
}

export async function listAiModelCalls(limit = 100) {
  const rows = await prisma.aiModelCall.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, traceId: true, provider: true, model: true, taskClass: true, status: true, latencyMs: true, tokensIn: true, tokensOut: true, dataClass: true, agentName: true, createdAt: true } });
  return rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
}
export async function getAiCallStats() {
  const rows = await prisma.aiModelCall.groupBy({ by: ["provider", "status"], _count: { _all: true }, _avg: { latencyMs: true }, _sum: { tokensIn: true, tokensOut: true } });
  return rows.map((r) => ({ provider: r.provider, status: r.status, calls: r._count._all, avgLatencyMs: Math.round(r._avg.latencyMs ?? 0), tokensIn: r._sum.tokensIn ?? 0, tokensOut: r._sum.tokensOut ?? 0 }));
}
