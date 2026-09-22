/**
 * Admin panel: read views + audited decision actions (spec §37, §92, §140).
 *
 * The admin surface only performs the three decision actions below. Each must
 * snapshot before/after into the audit log, and none may touch money, payouts
 * or document validity (those stay with their regulated domain services).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  getAdminOverview,
  listAdminUsers,
  listAdminOrders,
  listVerificationQueue,
  listRiskEvents,
  listAuditLog,
  setUserBlocked,
  reviewRiskEvent,
  decideVerification,
  listAiModelCalls,
  getAiCallStats,
} from "../src/lib/domains/admin";
import { hashPassword } from "../src/lib/auth";

const W = process.env.VITEST_WORKER_ID ?? "0";

const ADMIN_EMAIL = `adm-admin@${W}.test`;
const BUYER_EMAIL = `adm-buyer@${W}.test`;
const SELLER_EMAIL = `adm-seller@${W}.test`;

let adminId = "";
let buyerId = "";
let sellerId = "";
let riskEventId = "";

beforeAll(async () => {
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, name: "Админ Тест", role: "ADMIN", passwordHash: await hashPassword("password123") },
    update: {},
  });
  adminId = admin.id;

  const buyer = await prisma.user.upsert({
    where: { email: BUYER_EMAIL },
    create: { email: BUYER_EMAIL, name: "Покупатель Тест", role: "BUYER", passwordHash: await hashPassword("password123") },
    update: { isBlocked: false },
  });
  buyerId = buyer.id;

  const sellerUser = await prisma.user.upsert({
    where: { email: SELLER_EMAIL },
    create: { email: SELLER_EMAIL, name: "Продавец Тест", role: "SELLER", passwordHash: await hashPassword("password123") },
    update: {},
  });
  const seller = await prisma.sellerProfile.upsert({
    where: { slug: `adm-seller-${W}` },
    create: {
      userId: sellerUser.id,
      slug: `adm-seller-${W}`,
      displayName: "Продавец Тест",
      isActivated: true,
      identityStatus: "PENDING",
      inn: "770000000000",
    },
    update: { isActivated: true, identityStatus: "PENDING" },
  });
  sellerId = seller.id;

  await prisma.product.upsert({
    where: { sku: `ADM-${W}` },
    create: {
      sellerId,
      sku: `ADM-${W}`,
      title: "Товар для админ-обзора",
      priceKopecks: 100000,
      status: "ACTIVE",
    },
    update: { status: "ACTIVE" },
  });

  const risk = await prisma.riskEvent.create({
    data: {
      actorType: "buyer",
      actorId: buyerId,
      level: "REVIEW",
      ruleId: "test_rule",
      description: "Тестовое risk-событие",
    },
  });
  riskEventId = risk.id;
});

describe("admin read views", () => {
  it("aggregates platform overview from real data", async () => {
    const overview = await getAdminOverview();
    expect(overview.users.total).toBeGreaterThan(0);
    expect(overview.users.sellers).toBeGreaterThan(0);
    expect(overview.products.total).toBeGreaterThan(0);
    expect(typeof overview.payments.grossKopecks).toBe("number");
    // The destructured fields must line up with the query results — a shifted
    // destructuring silently returns wrong types here (found in audit).
    expect(typeof overview.risk.openEvents).toBe("number");
    expect(overview.risk.byLevel).toBeTypeOf("object");
  });

  it("lists users with their seller profile", async () => {
    const users = await listAdminUsers();
    const admin = users.find((u) => u.email === ADMIN_EMAIL);
    expect(admin?.role).toBe("ADMIN");
    const sellerUser = users.find((u) => u.email === SELLER_EMAIL);
    expect(sellerUser?.seller?.displayName).toBe("Продавец Тест");
  });

  it("lists orders with payment and shipment", async () => {
    const orders = await listAdminOrders();
    // No orders exist for this seller yet; the view must still resolve.
    expect(Array.isArray(orders)).toBe(true);
  });

  it("lists the verification queue", async () => {
    const queue = await listVerificationQueue();
    const ours = queue.find((s) => s.id === sellerId);
    expect(ours?.identityStatus).toBe("PENDING");
    expect(ours?.inn).toBe("770000000000");
  });

  it("lists risk events", async () => {
    const events = await listRiskEvents();
    expect(events.some((e) => e.id === riskEventId)).toBe(true);
  });

  it("lists the audit log", async () => {
    const logs = await listAuditLog();
    expect(Array.isArray(logs)).toBe(true);
  });
});

describe("admin decision actions", () => {
  it("blocks and unblocks a user, auditing both", async () => {
    const blocked = await setUserBlocked(buyerId, true, adminId);
    expect(blocked.isBlocked).toBe(true);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: buyerId } })).toHaveProperty(
      "isBlocked",
      true
    );

    const unblocked = await setUserBlocked(buyerId, false, adminId);
    expect(unblocked.isBlocked).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: {
        actorId: adminId,
        targetType: "User",
        targetId: buyerId,
      },
      orderBy: { createdAt: "asc" },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("user_blocked");
    expect(actions).toContain("user_unblocked");
    // Each entry must snapshot the state transition. SQLite stores the
    // before/after payload as stringified JSON (no Json column type).
    const blockEntry = audit.find((a) => a.action === "user_blocked");
    expect(JSON.parse(blockEntry?.before ?? "null")).toMatchObject({ isBlocked: false });
    expect(JSON.parse(blockEntry?.after ?? "null")).toMatchObject({ isBlocked: true });
  });

  it("refuses to block an admin", async () => {
    await expect(setUserBlocked(adminId, true, adminId)).rejects.toThrow(/администратор/i);
  });

  it("is idempotent when the state already matches", async () => {
    await setUserBlocked(buyerId, false, adminId);
    const result = await setUserBlocked(buyerId, false, adminId);
    expect(result.isBlocked).toBe(false);
    // A no-op must not create a duplicate audit entry.
    const count = await prisma.auditLog.count({
      where: { actorId: adminId, action: "user_unblocked", targetId: buyerId },
    });
    expect(count).toBe(1);
  });

  it("reviews a risk event exactly once", async () => {
    const reviewed = await reviewRiskEvent(riskEventId, "acknowledged_by_admin", adminId);
    expect(reviewed.reviewedAt).not.toBeNull();

    // A replay is a no-op, not a second audit entry.
    const again = await reviewRiskEvent(riskEventId, "something else", adminId);
    expect(again.reviewedAt).toEqual(reviewed.reviewedAt);

    const audit = await prisma.auditLog.count({
      where: { action: "risk_event_reviewed", targetId: riskEventId },
    });
    expect(audit).toBe(1);
  });

  it("approves verification as manual_review, never as an official check", async () => {
    const result = await decideVerification(sellerId, "identity", true, "Ручная проверка", adminId);
    expect(result.status).toBe("VERIFIED");

    const record = await prisma.verificationRecord.findFirstOrThrow({
      where: { sellerId, kind: "identity" },
    });
    // spec §49: a manual decision must never look like an official ESIA/FNS check.
    expect(record.source).toBe("manual_review");
    expect(record.status).toBe("VERIFIED");

    const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerId } });
    expect(seller.identityStatus).toBe("VERIFIED");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "verification_approved", targetId: sellerId },
    });
    expect(JSON.parse(audit.before ?? "null")).toMatchObject({ identityStatus: "PENDING" });
  });

  it("rejects verification without lifting identity status", async () => {
    await prisma.sellerProfile.update({
      where: { id: sellerId },
      data: { identityStatus: "PENDING" },
    });
    const result = await decideVerification(sellerId, "identity", false, "Не хватает документов", adminId);
    expect(result.status).toBe("REJECTED");

    const seller = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: sellerId } });
    // A rejection records the decision but leaves the seller unverified.
    expect(seller.identityStatus).not.toBe("VERIFIED");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "verification_rejected", targetId: sellerId },
    });
    expect(JSON.parse(audit.after ?? "null")).toMatchObject({ status: "REJECTED", source: "manual_review" });
  });
});

describe("AI observability views (spec §93)", () => {
  it("lists model calls without exposing payloads", async () => {
    await prisma.aiModelCall.create({
      data: {
        traceId: `adm-trace-${W}`,
        provider: "mock",
        model: "svetlana-mock",
        taskClass: "buyer_search",
        status: "success",
        latencyMs: 42,
        tokensIn: 10,
        tokensOut: 20,
        dataClass: "public_catalog",
      },
    });

    const calls = await listAiModelCalls();
    const ours = calls.find((c) => c.traceId === `adm-trace-${W}`);
    expect(ours?.provider).toBe("mock");
    expect(ours?.latencyMs).toBe(42);
    // No prompt or completion text is selected — only metadata.
    expect(ours).not.toHaveProperty("prompt");
    expect(ours).not.toHaveProperty("completion");
  });

  it("aggregates provider stats", async () => {
    const stats = await getAiCallStats();
    const mock = stats.find((s) => s.provider === "mock");
    expect(mock?.calls).toBeGreaterThan(0);
    expect(typeof mock?.avgLatencyMs).toBe("number");
  });
});
