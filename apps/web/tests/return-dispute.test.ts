/**
 * Buyer return & dispute tools (spec §29, §42).
 *
 * These lock in two honesty rules:
 *  1. A return is only possible from a status the state machine permits —
 *     never a fabricated RETURN_REQUESTED.
 *  2. Svetlana opens a dispute and collects evidence, but the verdict on an
 *     adjudicated case belongs to a human (ESCALATED_HUMAN), never to the AI.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { toolRegistry } from "../src/lib/ai/tools";
import { hashPassword } from "../src/lib/auth";
import { transitionOrder } from "../src/lib/domains/orders";

const EMAIL = `return-buyer@${process.env.VITEST_WORKER_ID ?? "0"}.test`;
const SELLER_EMAIL = `return-seller@${process.env.VITEST_WORKER_ID ?? "0"}.test`;

let userId = "";
let sellerId = "";
let deliveredOrderId = "";
let paidOrderId = "";

async function resetProductStock() {
  const product = await prisma.product.upsert({
    where: { sku: "return-sku-1" },
    create: {
      sku: "return-sku-1",
      title: "Товар для возврата",
      priceKopecks: 500000,
      sellerId,
      status: "PUBLISHED",
      description: "Тестовый товар",
    },
    update: { status: "PUBLISHED", priceKopecks: 500000 },
  });
  await prisma.inventory.upsert({
    where: { productId: product.id },
    create: { productId: product.id, quantity: 5, availability: "AVAILABLE", confirmedAt: new Date() },
    update: { quantity: 5, availability: "AVAILABLE", confirmedAt: new Date() },
  });
  return product.id;
}

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, name: "Покупатель возвратов", passwordHash: await hashPassword("password123") },
    update: {},
  });
  userId = user.id;

  const sellerUser = await prisma.user.upsert({
    where: { email: SELLER_EMAIL },
    create: {
      email: SELLER_EMAIL,
      name: "Продавец возвратов",
      role: "SELLER",
      passwordHash: await hashPassword("password123"),
    },
    update: {},
  });
  const seller = await prisma.sellerProfile.upsert({
    where: { slug: "return-seller" },
    create: {
      userId: sellerUser.id,
      slug: "return-seller",
      displayName: "Продавец возвратов",
      isActivated: true,
    },
    update: { isActivated: true },
  });
  sellerId = seller.id;

  const productId = await resetProductStock();

  // Two orders: one delivered (returnable), one merely paid (not returnable).
  const group = await prisma.orderGroup.create({
    data: {
      buyerId: userId,
      currency: "RUB",
      totalKopecks: 500000,
      idempotencyKey: `return-group-${process.env.VITEST_WORKER_ID ?? "0"}-${Date.now()}`,
      orders: {
        create: [
          {
            number: `RET-DEL-${Date.now()}`,
            sellerId,
            buyerId: userId,
            status: "CREATED",
            totalKopecks: 500000,
            currency: "RUB",
            items: { create: [{ productId, titleSnapshot: "Товар для возврата", quantity: 1, priceKopecks: 500000 }] },
          },
          {
            number: `RET-PAID-${Date.now()}`,
            sellerId,
            buyerId: userId,
            status: "CREATED",
            totalKopecks: 500000,
            currency: "RUB",
            items: { create: [{ productId, titleSnapshot: "Товар для возврата", quantity: 1, priceKopecks: 500000 }] },
          },
        ],
      },
    },
    include: { orders: true },
  });

  const advance = async (id: string, to: string) => {
    const path: Record<string, string[]> = {
      PAID: ["PAYMENT_PENDING", "PAID"],
      DELIVERED: ["PAYMENT_PENDING", "PAID", "CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"],
    };
    for (const step of path[to]) {
      const res = await transitionOrder({
        orderId: id,
        to: step,
        actorId: userId,
        actorRole: "buyer",
        actingUserId: userId,
      });
      if (!res.ok) throw new Error(`transition ${step} failed: ${res.note}`);
    }
  };

  deliveredOrderId = group.orders[0].id;
  paidOrderId = group.orders[1].id;
  await advance(deliveredOrderId, "DELIVERED");
  await advance(paidOrderId, "PAID");
});

function ctx() {
  return { userId, role: "buyer", traceId: "test-return", confirm: async () => true };
}

describe("request_return tool (spec §29)", () => {
  it("requests a return on a delivered order", async () => {
    const tool = toolRegistry.get("request_return");
    expect(tool).toBeDefined();

    const result = await tool!.execute(ctx(), {
      orderId: deliveredOrderId,
      reason: "ITEM_DAMAGED",
      comment: "Повреждение при доставке",
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ status: "RETURN_REQUESTED", reason: "ITEM_DAMAGED" });

    const persisted = await prisma.order.findUnique({ where: { id: deliveredOrderId } });
    expect(persisted?.status).toBe("RETURN_REQUESTED");
  });

  it("refuses a return when the order status does not allow it", async () => {
    const tool = toolRegistry.get("request_return");

    const result = await tool!.execute(ctx(), {
      orderId: paidOrderId,
      reason: "NO_LONGER_NEEDED",
    });

    expect(result.ok).toBe(false);
    expect(result.verification).toBe("NOT_PROVEN");

    const persisted = await prisma.order.findUnique({ where: { id: paidOrderId } });
    expect(persisted?.status).toBe("PAID");
  });

  it("rejects an invalid reason", async () => {
    const tool = toolRegistry.get("request_return");
    const result = await tool!.execute(ctx(), { orderId: deliveredOrderId, reason: "BECAUSE" });
    expect(result.ok).toBe(false);
  });
});

describe("create_dispute tool (spec §42)", () => {
  it("opens a dispute and never resolves it itself", async () => {
    const tool = toolRegistry.get("create_dispute");

    const result = await tool!.execute(ctx(), {
      orderId: paidOrderId,
      reason: "PAYMENT_DISPUTE",
      description: "Списано дважды, нужен разбор",
    });

    expect(result.ok).toBe(true);

    const dispute = await prisma.dispute.findFirst({
      where: { orderId: paidOrderId },
      orderBy: { createdAt: "desc" },
    });
    expect(dispute).not.toBeNull();
    expect(dispute!.status).not.toBe("CLOSED");
    // Svetlana may only move a dispute into evidence collection or escalation —
    // never straight to a verdict.
    expect(["OPEN", "EVIDENCE_COLLECTION", "ESCALATED_HUMAN"]).toContain(dispute!.status);
  });

  it("requires a meaningful description", async () => {
    const tool = toolRegistry.get("create_dispute");
    const result = await tool!.execute(ctx(), {
      orderId: paidOrderId,
      reason: "ITEM_DAMAGED",
      description: "коротко",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a second open dispute on the same order", async () => {
    const tool = toolRegistry.get("create_dispute");
    const result = await tool!.execute(ctx(), {
      orderId: paidOrderId,
      reason: "ITEM_DAMAGED",
      description: "Повторный спор по тому же заказу",
    });
    expect(result.ok).toBe(false);
  });
});
