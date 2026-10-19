import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { acceptQuote, decideQuote, listBuyerQuotes, listSellerQuotes } from "../src/lib/domains/b2b-quotes";
import { evaluateOrderRisk } from "../src/lib/domains/risk";

const W = process.env.VITEST_WORKER_ID ?? "0";

describe("КП после B2B-торга: продавец подтверждает, покупатель заказывает по цене КП", () => {
  let sellerId = "";
  let sellerUserId = "";
  let otherSellerId = "";
  let buyerId = "";
  let productId = "";

  beforeAll(async () => {
    const pass = await hashPassword("password123");
    const sellerUser = await prisma.user.create({ data: { email: `kp-seller@${W}.test`, name: "Оптовик КП", role: "SELLER", passwordHash: pass } });
    sellerUserId = sellerUser.id;
    const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, slug: `kp-seller-${W}`, displayName: "Оптовик КП", isActivated: true, businessStatus: "VERIFIED" } });
    sellerId = seller.id;
    const otherUser = await prisma.user.create({ data: { email: `kp-other@${W}.test`, name: "Чужой продавец", role: "SELLER", passwordHash: pass } });
    otherSellerId = (await prisma.sellerProfile.create({ data: { userId: otherUser.id, slug: `kp-other-${W}`, displayName: "Чужой", isActivated: true } })).id;
    buyerId = (await prisma.user.create({ data: { email: `kp-buyer@${W}.test`, name: "Закупщик", passwordHash: pass } })).id;
    productId = (
      await prisma.product.create({
        data: {
          sellerId,
          sku: `KP-${W}`,
          title: "Перчатки рабочие",
          priceKopecks: 100000,
          status: "ACTIVE",
          inventory: { create: { quantity: 1000, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() } },
        },
      })
    ).id;
  });

  async function negotiateQuote(): Promise<string> {
    const res = await toolRegistry.get("negotiate_quote")!.execute({ userId: buyerId, role: "buyer", traceId: `kp-${W}` }, { productId, quantity: 100, targetPriceRub: 800, maxPriceRub: 900 });
    expect(res.ok).toBe(true);
    const data = res.data as { status: string; quoteId: string | null };
    expect(data.status).toBe("AGREED");
    expect(data.quoteId).toBeTruthy();
    expect(res.summary).toContain("/quotes");
    return data.quoteId as string;
  }

  it("полный путь: КП → подтверждение → заказ по цене КП → оплата не блокируется", async () => {
    const quoteId = await negotiateQuote();
    const mine = await listBuyerQuotes(buyerId);
    const q = mine.find((x) => x.id === quoteId)!;
    expect(q.status).toBe("AWAITING_SELLER");
    expect((await listSellerQuotes(sellerId)).some((x) => x.id === quoteId)).toBe(true);
    expect((await listSellerQuotes(otherSellerId)).some((x) => x.id === quoteId)).toBe(false);

    // Без подтверждения продавца заказать нельзя; чужой продавец решать не может.
    await expect(acceptQuote(quoteId, buyerId)).rejects.toThrow(/не подтверждено/);
    await expect(decideQuote(quoteId, otherSellerId, sellerUserId, true)).rejects.toThrow(/не найдено/);

    await decideQuote(quoteId, sellerId, sellerUserId, true);
    await expect(decideQuote(quoteId, sellerId, sellerUserId, false)).rejects.toThrow(/уже принято/);
    // Чужой покупатель не может оформить чужое КП.
    await expect(acceptQuote(quoteId, sellerUserId)).rejects.toThrow(/не найдено/);

    const order = await acceptQuote(quoteId, buyerId);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, include: { items: true } });
    expect(saved.status).toBe("PAYMENT_PENDING");
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].quantity).toBe(100);
    expect(saved.items[0].priceKopecks).toBe(q.unitPriceKopecks);
    expect(saved.items[0].priceKopecks).toBeLessThan(100000);
    expect(saved.totalKopecks).toBe(q.unitPriceKopecks * 100);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    expect(inv.quantity).toBe(900);
    // Цена в каталоге не изменилась.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).priceKopecks).toBe(100000);

    await expect(acceptQuote(quoteId, buyerId)).rejects.toThrow(/уже оформлен/);

    const verdict = await evaluateOrderRisk(order.groupId);
    expect(verdict.ruleId).not.toBe("R5_price_mismatch");
    expect(verdict.level).not.toBe("BLOCKED");

    // Подмена цены в КП прямо в базе: КП больше не подлинное, оплата блокируется.
    const row = await prisma.pendingAction.findUniqueOrThrow({ where: { id: quoteId } });
    await prisma.pendingAction.update({ where: { id: quoteId }, data: { args: row.args.replace(`"unitPriceKopecks":${q.unitPriceKopecks}`, `"unitPriceKopecks":${q.unitPriceKopecks - 10000}`) } });
    const tampered = await evaluateOrderRisk(order.groupId);
    expect(tampered.ruleId).toBe("R5_price_mismatch");
    expect(tampered.level).toBe("BLOCKED");
  });

  it("продавец отклонил КП: заказать по нему нельзя", async () => {
    const quoteId = await negotiateQuote();
    await decideQuote(quoteId, sellerId, sellerUserId, false);
    await expect(acceptQuote(quoteId, buyerId)).rejects.toThrow(/не подтверждено/);
  });

  it("обычный заказ с ценой не по каталогу по-прежнему блокируется (R5)", async () => {
    const group = await prisma.orderGroup.create({ data: { buyerId, idempotencyKey: `kp-r5-${W}` } });
    const o = await prisma.order.create({
      data: { groupId: group.id, buyerId, sellerId, number: `KPR5-${W}`, status: "PAYMENT_PENDING", subtotalKopecks: 50000, totalKopecks: 50000, deliveryAddress: JSON.stringify({ kind: "B2B_QUOTE", quoteId: "fake-quote" }) },
    });
    await prisma.orderItem.create({ data: { orderId: o.id, productId, titleSnapshot: "Перчатки", priceKopecks: 50000, quantity: 1 } });
    const verdict = await evaluateOrderRisk(group.id);
    expect(verdict.ruleId).toBe("R5_price_mismatch");
  });
});
