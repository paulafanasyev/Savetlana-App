import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { acceptQuote, decideQuote } from "../src/lib/domains/b2b-quotes";
import { getAgentEffectiveness } from "../src/lib/domains/agent-effectiveness";

const W = process.env.VITEST_WORKER_ID ?? "0";

describe("Дашборд эффективности агента", () => {
  let sellerId = "";
  let sellerUserId = "";
  let buyerId = "";
  let productId = "";

  beforeAll(async () => {
    const pass = await hashPassword("password123");
    const su = await prisma.user.create({ data: { email: `ae-seller@${W}.test`, name: "Оптовик AE", role: "SELLER", passwordHash: pass } });
    sellerUserId = su.id;
    sellerId = (await prisma.sellerProfile.create({ data: { userId: su.id, slug: `ae-seller-${W}`, displayName: "Оптовик AE", isActivated: true, businessStatus: "VERIFIED" } })).id;
    buyerId = (await prisma.user.create({ data: { email: `ae-buyer@${W}.test`, name: "Закупщик AE", passwordHash: pass } })).id;
    productId = (
      await prisma.product.create({
        data: {
          sellerId,
          sku: `AE-${W}`,
          title: "Респиратор строительный",
          priceKopecks: 100000,
          status: "ACTIVE",
          inventory: { create: { quantity: 1000, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() } },
        },
      })
    ).id;
  });

  const run = (args: Record<string, unknown>) => toolRegistry.get("negotiate_quote")!.execute({ userId: buyerId, role: "buyer", traceId: `ae-${W}` }, args);

  it("торг, КП, решение продавца и заказ попадают в метрики", async () => {
    const before = await getAgentEffectiveness();

    const ok = await run({ productId, quantity: 100, targetPriceRub: 800, maxPriceRub: 900 });
    const quoteId = (ok.data as { quoteId: string }).quoteId;
    expect(quoteId).toBeTruthy();
    // Бюджет ниже любого возможного: сделки нет.
    await run({ productId, quantity: 100, targetPriceRub: 10, maxPriceRub: 20 });

    await decideQuote(quoteId, sellerId, sellerUserId, true);
    await acceptQuote(quoteId, buyerId);

    const after = await getAgentEffectiveness();
    expect(after.negotiations.total - before.negotiations.total).toBe(2);
    expect(after.negotiations.agreed - before.negotiations.agreed).toBe(1);
    expect(after.negotiations.noDeal + after.negotiations.needsHuman - before.negotiations.noDeal - before.negotiations.needsHuman).toBe(1);
    expect(after.quotes.total - before.quotes.total).toBe(1);
    expect(after.quotes.ordered - before.quotes.ordered).toBe(1);
    expect(after.money.buyerSavingsKopecks).toBeGreaterThan(before.money.buyerSavingsKopecks);
    expect(after.money.orderedGmvKopecks).toBeGreaterThan(before.money.orderedGmvKopecks);
    expect(after.quotes.medianSellerResponseMin).not.toBeNull();
    expect(after.quotes.orderConversion).toBeGreaterThan(0);
  });

  it("подделанное КП считается в безопасности, а не в обороте", async () => {
    const res = await run({ productId, quantity: 50, targetPriceRub: 850, maxPriceRub: 950 });
    const quoteId = (res.data as { quoteId: string }).quoteId;
    const before = await getAgentEffectiveness();
    const row = await prisma.pendingAction.findUniqueOrThrow({ where: { id: quoteId } });
    await prisma.pendingAction.update({ where: { id: quoteId }, data: { args: row.args.replace('"quantity":50', '"quantity":5000') } });
    const after = await getAgentEffectiveness();
    expect(after.safety.quoteTampered - before.safety.quoteTampered).toBe(1);
    expect(after.quotes.total - before.quotes.total).toBe(-1);
  });

  it("запрос цены у нескольких продавцов пишется как RFQ", async () => {
    const before = await getAgentEffectiveness();
    await run({ query: "респиратор строительный", quantity: 10 });
    const after = await getAgentEffectiveness();
    expect(after.negotiations.rfq - before.negotiations.rfq).toBe(1);
    expect(after.negotiations.sellersAsked - before.negotiations.sellersAsked).toBeGreaterThanOrEqual(1);
  });
});
