import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { acceptQuote, decideQuote } from "../src/lib/domains/b2b-quotes";
import { buildQuoteDocument, plural, rublesInWords } from "../src/lib/domains/quote-documents";

const W = process.env.VITEST_WORKER_ID ?? "0";

describe("Сумма прописью", () => {
  it("рубли и копейки в правильных формах", () => {
    expect(rublesInWords(12345600)).toBe("Сто двадцать три тысячи четыреста пятьдесят шесть рублей 00 копеек");
    expect(rublesInWords(4200000)).toBe("Сорок две тысячи рублей 00 копеек");
    expect(rublesInWords(2112)).toBe("Двадцать один рубль 12 копеек");
    expect(rublesInWords(100000000)).toBe("Один миллион рублей 00 копеек");
    expect(rublesInWords(52)).toBe("Ноль рублей 52 копейки");
    expect(plural(11, "рубль", "рубля", "рублей")).toBe("рублей");
    expect(plural(22, "рубль", "рубля", "рублей")).toBe("рубля");
  });
});

describe("Документы по КП: договор, счёт, УПД", () => {
  let sellerId = "";
  let sellerUserId = "";
  let buyerId = "";
  let strangerId = "";
  let productId = "";

  beforeAll(async () => {
    const pass = await hashPassword("password123");
    const su = await prisma.user.create({ data: { email: `qd-seller@${W}.test`, name: "Оптовик Документы", role: "SELLER", passwordHash: pass } });
    sellerUserId = su.id;
    sellerId = (await prisma.sellerProfile.create({ data: { userId: su.id, slug: `qd-seller-${W}`, displayName: "Оптовик Документы", isActivated: true, businessStatus: "VERIFIED", sellerType: "COMPANY", inn: "0099001018", ogrn: "1009900101012" } })).id;
    buyerId = (await prisma.user.create({ data: { email: `qd-buyer@${W}.test`, name: "Закупщик Документы", passwordHash: pass } })).id;
    strangerId = (await prisma.user.create({ data: { email: `qd-stranger@${W}.test`, name: "Посторонний", passwordHash: pass } })).id;
    productId = (
      await prisma.product.create({
        data: {
          sellerId,
          sku: `QD-${W}`,
          title: "Каска защитная",
          priceKopecks: 50000,
          status: "ACTIVE",
          inventory: { create: { quantity: 1000, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() } },
        },
      })
    ).id;
  });

  it("договор сразу, счёт и УПД только после заказа; посторонний не видит", async () => {
    const res = await toolRegistry.get("negotiate_quote")!.execute({ userId: buyerId, role: "buyer", traceId: `qd-${W}` }, { productId, quantity: 100, targetPriceRub: 400, maxPriceRub: 460 });
    const quoteId = (res.data as { quoteId: string }).quoteId;
    expect(quoteId).toBeTruthy();

    const draft = await buildQuoteDocument(quoteId, "contract", { userId: buyerId });
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(draft.doc.draft).toBe(true);
    expect((await buildQuoteDocument(quoteId, "invoice", { userId: buyerId })).ok).toBe(false);
    expect((await buildQuoteDocument(quoteId, "contract", { userId: strangerId })).ok).toBe(false);

    await decideQuote(quoteId, sellerId, sellerUserId, true);
    const contract = await buildQuoteDocument(quoteId, "contract", { userId: sellerUserId, sellerId });
    expect(contract.ok).toBe(true);
    if (contract.ok) {
      expect(contract.doc.draft).toBe(false);
      expect(contract.doc.seller.inn).toBe("0099001018");
      expect(contract.doc.totalKopecks).toBe(contract.doc.quote.unitPriceKopecks * 100);
    }

    const order = await acceptQuote(quoteId, buyerId);
    const invoice = await buildQuoteDocument(quoteId, "invoice", { userId: buyerId });
    expect(invoice.ok).toBe(true);
    if (invoice.ok) {
      expect(invoice.doc.orderNumber).toBe(order.number);
      expect(invoice.doc.totalInWords).toMatch(/рубл/);
      expect(invoice.doc.fingerprint).toHaveLength(16);
    }
    expect((await buildQuoteDocument(quoteId, "upd", { userId: sellerUserId, sellerId })).ok).toBe(true);

    // Подмена условий в базе: документ больше не формируется.
    const row = await prisma.pendingAction.findUniqueOrThrow({ where: { id: quoteId } });
    await prisma.pendingAction.update({ where: { id: quoteId }, data: { args: row.args.replace('"quantity":100', '"quantity":1') } });
    expect((await buildQuoteDocument(quoteId, "invoice", { userId: buyerId })).ok).toBe(false);
  });
});
