import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  openDispute,
  appendMessage,
  attachEvidence,
  transitionDispute,
  escalateToHuman,
  fileAppeal,
  resolveDispute,
  getDisputeCase,
  listAdminDisputeQueue,
  assignAdmin,
  startSellerSla,
  checkSlaBreaches,
  type CreateDisputeInput,
} from "../src/lib/domains/disputes";

const BUYER = "disp-buyer";
const SELLER_USER = "disp-seller-user";
const SELLER = "disp-seller";
const ADMIN = "disp-admin";
const ORDER = "disp-order";
const ORDER_2 = "disp-order-2";
const CATEGORY = "disp-category";
const PRODUCT = "disp-product";

let caseId = "";

beforeAll(async () => {
  const passwordHash = await hashPassword("password123");
  await prisma.user.upsert({
    where: { id: BUYER },
    create: { id: BUYER, email: "disp-buyer@example.test", passwordHash, name: "Покупатель", role: "BUYER" },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: SELLER_USER },
    create: { id: SELLER_USER, email: "disp-seller@example.test", passwordHash, name: "Продавец", role: "SELLER" },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: ADMIN },
    create: { id: ADMIN, email: "disp-admin@example.test", passwordHash, name: "Админ", role: "ADMIN" },
    update: {},
  });
  await prisma.sellerProfile.upsert({
    where: { id: SELLER },
    create: {
      id: SELLER,
      userId: SELLER_USER,
      displayName: "Магазин тест",
      slug: "disp-seller",
      identityStatus: "VERIFIED",
      npdStatus: "VERIFIED",
      isActivated: true,
    },
    update: {},
  });
  await prisma.category.upsert({
    where: { id: CATEGORY },
    create: { id: CATEGORY, name: "Тест-категория", slug: "disp-category" },
    update: {},
  });
  await prisma.product.upsert({
    where: { id: PRODUCT },
    create: {
      id: PRODUCT,
      sellerId: SELLER,
      categoryId: CATEGORY,
      sku: "disp-sku",
      title: "Тест-товар",
      priceKopecks: 100000,
      status: "ACTIVE",
    },
    update: {},
  });
  for (const [orderId, itemId] of [
    [ORDER, "disp-item"],
    [ORDER_2, "disp-item-2"],
  ] as const) {
    await prisma.order.upsert({
      where: { id: orderId },
      create: {
        id: orderId,
        buyerId: BUYER,
        sellerId: SELLER,
        number: `${orderId}-1`,
        status: "DELIVERED",
        totalKopecks: 100000,
        items: {
          create: [{ id: itemId, productId: PRODUCT, titleSnapshot: "Тест-товар", priceKopecks: 100000, quantity: 1 }],
        },
      },
      update: {},
    });
    // A buyer-side verdict must map to a real payment — a refund is not
    // payable without one (spec §25).
    await prisma.payment.upsert({
      where: { id: `disp-payment-${orderId}` },
      create: {
        id: `disp-payment-${orderId}`,
        orderId,
        buyerId: BUYER,
        provider: "sandbox",
        providerRef: `sandbox-${orderId}`,
        amountKopecks: 100000,
        status: "SUCCEEDED",
      },
      update: {},
    });
  }
  await prisma.dispute.deleteMany({ where: { OR: [{ orderId: ORDER }, { orderId: ORDER_2 }] } });
});

async function hashPassword(plain: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(plain, 10);
}

const CASE_INPUT: CreateDisputeInput = {
  orderId: ORDER,
  buyerId: BUYER,
  reason: "ITEM_NOT_AS_DESCRIBED",
  description: "Товар приехал разбитым",
};

describe("dispute center", () => {
  it("opens a dispute and records history", async () => {
    const dispute = await openDispute(CASE_INPUT);
    caseId = dispute.id;
    expect(dispute.status).toBe("OPEN");
    expect(dispute.reason).toBe("ITEM_NOT_AS_DESCRIBED");

    const history = await prisma.disputeHistory.findMany({
      where: { disputeId: caseId },
    });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].action).toBe("dispute_opened");
  });

  it("appends messages visible to both parties", async () => {
    await appendMessage(caseId, BUYER, "buyer", "Прошу вернуть деньги", false);
    await appendMessage(caseId, SELLER_USER, "seller", "Запрошу фото повреждения", false);

    const messages = await prisma.disputeMessage.findMany({
      where: { disputeId: caseId, isInternal: false },
      orderBy: { createdAt: "asc" },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toBe("Прошу вернуть деньги");
    expect(messages[1].authorRole).toBe("seller");
  });

  it("keeps internal notes hidden from buyers", async () => {
    await appendMessage(caseId, ADMIN, "admin", "Внутренняя заметка", true);

    const buyerView = await getDisputeCase(caseId, BUYER, "BUYER");
    expect(buyerView).not.toBeNull();
    expect(buyerView!.messages.every((m) => !m.isInternal)).toBe(true);

    const adminView = await getDisputeCase(caseId, ADMIN, "ADMIN");
    expect(adminView!.messages.some((m) => m.isInternal)).toBe(true);
  });

  it("denies case access to a third party", async () => {
    const stranger = await getDisputeCase(caseId, "some-other-user", "BUYER");
    expect(stranger).toBeNull();
  });

  it("attaches evidence and links it to the case", async () => {
    const ev = await attachEvidence(caseId, BUYER, {
      kind: "photo",
      storageKey: "dispute/photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      contentHash: "abc123",
    });
    expect(ev.verified).toBe(false);

    const stored = await prisma.disputeEvidence.findUnique({ where: { id: ev.id } });
    expect(stored?.fileName).toBe("photo.jpg");
  });

  it("starts the seller SLA and flags a breach", async () => {
    await startSellerSla(caseId);
    // Force the deadline into the past to simulate a missed response window.
    await prisma.dispute.update({
      where: { id: caseId },
      data: { sellerSlaUntil: new Date(Date.now() - 60_000) },
    });
    await checkSlaBreaches();

    const dispute = await prisma.dispute.findUnique({ where: { id: caseId } });
    expect(dispute?.slaBreached).toBe(true);
  });

  it("rejects an illegal transition", async () => {
    // OPEN cannot jump straight to a verdict: evidence must be gathered first.
    await expect(
      transitionDispute(caseId, BUYER, "buyer", "RESOLVED_BUYER", "попытка обойти"),
    ).rejects.toThrow();
  });

  it("transitions a dispute legally", async () => {
    const updated = await transitionDispute(
      caseId,
      BUYER,
      "buyer",
      "EVIDENCE_COLLECTION",
      "Начинаю сбор доказательств",
    );
    expect(updated.status).toBe("EVIDENCE_COLLECTION");
  });

  it("escalates to a human arbiter", async () => {
    const escalated = await escalateToHuman(caseId, BUYER, "Нужна модерация");
    expect(escalated.status).toBe("ESCALATED_HUMAN");
  });

  it("assigns an admin to the case", async () => {
    const assigned = await assignAdmin(caseId, ADMIN);
    expect(assigned.assignedAdminId).toBe(ADMIN);
  });

  it("resolves in favour of the buyer with a real refund record", async () => {
    // A winning buyer must produce an actual Refund row — money moves through
    // the payment provider later, but the obligation is recorded now.
    const result = await resolveDispute({
      disputeId: caseId,
      actorId: ADMIN,
      winner: "buyer",
      reasonCode: "ITEM_DAMAGED",
      resolution: "Товар повреждён — возврат оформлен",
      refundAmountKopecks: 100000,
    });
    expect(result.status).toBe("RESOLVED_BUYER");
    expect(result.refundId).toBeDefined();

    const refund = await prisma.refund.findUnique({ where: { id: result.refundId! } });
    expect(refund?.amountKopecks).toBe(100000);
    expect(refund?.status).toBe("PENDING");
  });

  it("blocks a double resolution", async () => {
    await expect(
      resolveDispute({
        disputeId: caseId,
        actorId: ADMIN,
        winner: "seller",
        reasonCode: "ITEM_DAMAGED",
        resolution: "повторное решение",
      }),
    ).rejects.toThrow();
  });

  it("lists the case in the admin queue", async () => {
    const queue = await listAdminDisputeQueue();
    expect(queue.some((d) => d.id === caseId)).toBe(true);
  });

  it("lets the buyer file an appeal after a verdict", async () => {
    const second = await openDispute({
      orderId: ORDER_2,
      buyerId: BUYER,
      reason: "ITEM_NOT_RECEIVED",
      description: "Вторая попытка",
    });
    await transitionDispute(second.id, BUYER, "buyer", "EVIDENCE_COLLECTION", "сбор");
    await escalateToHuman(second.id, BUYER, "на модерацию");
    await resolveDispute({
      disputeId: second.id,
      actorId: ADMIN,
      winner: "seller",
      reasonCode: "ITEM_NOT_RECEIVED",
      resolution: "Доказательства продавца подтверждены",
    });

    const appealed = await fileAppeal(second.id, BUYER, "Решение принято без учёта моих доказательств");
    expect(appealed.appealedAt).not.toBeNull();
  });
});
