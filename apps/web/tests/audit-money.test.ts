/**
 * Аудит 20.10: деньги в безопасной сделке.
 * Спор держит выплату, возврат не больше оплаты, продавец видит свои споры.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { createConsolidatedPayout, processRefund } from "../src/lib/domains/payments";
import { openDispute, listDisputesForUser } from "../src/lib/domains/disputes";

const W = process.env.VITEST_WORKER_ID ?? "0";
const RUN = `${W}-${Date.now()}`;

async function fixtures() {
  const buyer = await prisma.user.upsert({
    where: { email: `am-buyer@${W}.test` },
    create: { name: "AM Buyer", email: `am-buyer@${W}.test`, passwordHash: await hashPassword("password123"), role: "BUYER" },
    update: {},
  });
  const sellerUser = await prisma.user.upsert({
    where: { email: `am-seller@${W}.test` },
    create: { name: "AM Seller", email: `am-seller@${W}.test`, passwordHash: await hashPassword("password123"), role: "SELLER" },
    update: {},
  });
  const seller = await prisma.sellerProfile.upsert({
    where: { userId: sellerUser.id },
    create: { userId: sellerUser.id, displayName: "AM Seller", slug: `am-seller-${W}` },
    update: {},
  });
  return { buyerId: buyer.id, sellerUserId: sellerUser.id, sellerId: seller.id };
}

async function paidOrder(f: { buyerId: string; sellerId: string }, tag: string, status: string) {
  const order = await prisma.order.create({
    data: {
      buyerId: f.buyerId,
      sellerId: f.sellerId,
      number: `AM-${tag}-${RUN}`,
      status,
      totalKopecks: 200000,
      subtotalKopecks: 200000,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      buyerId: f.buyerId,
      provider: "sandbox-payment",
      providerRef: `sb_am_${tag}_${RUN}`,
      amountKopecks: 200000,
      status: "SUCCEEDED",
      sandbox: true,
    },
  });
  return { orderId: order.id, paymentId: payment.id };
}

describe("аудит денег: споры и возвраты", () => {
  it("открытый спор держит выплату продавцу, а продавец видит этот спор", async () => {
    const f = await fixtures();
    const { orderId } = await paidOrder(f, "hold", "COMPLETED");
    await prisma.settlement.create({
      data: {
        orderId,
        sellerId: f.sellerId,
        grossKopecks: 200000,
        platformFeeKopecks: 3000,
        paymentFeeKopecks: 0,
        deliveryKopecks: 0,
        adjustmentsKopecks: 0,
        payoutKopecks: 197000,
        status: "PENDING",
      },
    });
    const dispute = await openDispute({ orderId, buyerId: f.buyerId, reason: "ITEM_DAMAGED", description: "Разбито" });

    const payout = await createConsolidatedPayout({ sellerId: f.sellerId, actorId: f.sellerUserId, idempotencyKey: `am-po-${RUN}` });
    expect(payout.status).toBe("NOTHING_TO_PAYOUT");
    const settlement = await prisma.settlement.findFirstOrThrow({ where: { orderId } });
    expect(settlement.status).toBe("PENDING");
    expect(settlement.payoutId).toBeNull();

    const mine = await listDisputesForUser(f.sellerUserId);
    expect(mine.some((d) => d.id === dispute.id)).toBe(true);
  });

  it("возврат больше оплаченного не проводится", async () => {
    const f = await fixtures();
    const { orderId, paymentId } = await paidOrder(f, "over", "DELIVERED");
    const refund = await prisma.refund.create({
      data: { paymentId, orderId, amountKopecks: 250000, reason: "ITEM_DAMAGED" },
    });
    await expect(processRefund({ refundId: refund.id, actorId: f.buyerId, actorRole: "admin" })).rejects.toThrow();
    const after = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(after.status).toBe("FAILED");
    expect(after.providerRef).toBeNull();
  });

  it("два возврата вместе не превышают оплату", async () => {
    const f = await fixtures();
    const { orderId, paymentId } = await paidOrder(f, "twice", "DELIVERED");
    const first = await prisma.refund.create({ data: { paymentId, orderId, amountKopecks: 150000, reason: "PARTIAL" } });
    const ok = await processRefund({ refundId: first.id, actorId: f.buyerId, actorRole: "admin" });
    expect(ok.status).toBe("SUCCEEDED");
    const second = await prisma.refund.create({ data: { paymentId, orderId, amountKopecks: 100000, reason: "PARTIAL" } });
    await expect(processRefund({ refundId: second.id, actorId: f.buyerId, actorRole: "admin" })).rejects.toThrow();
  });
});
