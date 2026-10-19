import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { applyTerms, DEFAULT_TERMS, normalizeTerms, termsFromText } from "../src/lib/negotiation-terms";
import { saveSellerNegotiationPolicy, getSellerNegotiationPolicy } from "../src/lib/domains/negotiation-policy";
import { listBuyerQuotes } from "../src/lib/domains/b2b-quotes";
import { negotiationArgs } from "../src/lib/ai/negotiation-command";

const W = process.env.VITEST_WORKER_ID ?? "0";

describe("условия поставки и оплаты: арифметика", () => {
  it("без условий цена не меняется", () => {
    const t = applyTerms(88200, {}, DEFAULT_TERMS);
    expect(t).toMatchObject({ unitPriceKopecks: 88200, leadDays: 7, payment: "SAFE_DEAL", adjustmentPercent: 0, countered: false });
  });

  it("предоплата даёт скидку, срочность и отсрочка — наценку", () => {
    expect(applyTerms(88200, { payment: "PREPAY" }, DEFAULT_TERMS).unitPriceKopecks).toBe(86400);
    const t = applyTerms(88200, { leadDays: 2, payment: "DEFERRAL", deferralDays: 60 }, DEFAULT_TERMS);
    // Быстрее 3 дней нельзя, отсрочка не больше 30: агент предлагает ближайшее.
    expect(t).toMatchObject({ leadDays: 3, deferralDays: 30, adjustmentPercent: 4.5, countered: true, unitPriceKopecks: 92200 });
  });

  it("продавец без отсрочки: оплата через безопасную сделку", () => {
    const t = applyTerms(100000, { payment: "DEFERRAL", deferralDays: 30 }, { ...DEFAULT_TERMS, maxDeferralDays: 0 });
    expect(t).toMatchObject({ payment: "SAFE_DEAL", countered: true, unitPriceKopecks: 100000 });
  });

  it("правила продавца приводятся к разумным границам", () => {
    expect(normalizeTerms({ standardLeadDays: 5, rushLeadDays: 9, prepayDiscountPercent: 99 })).toMatchObject({ standardLeadDays: 5, rushLeadDays: 5, prepayDiscountPercent: 15 });
  });

  it("условия из текста, и «за 5 дней» не принимается за цену", () => {
    expect(termsFromText("нужно за 3 дня, с отсрочкой 30 дней")).toEqual({ leadDays: 3, payment: "DEFERRAL", deferralDays: 30 });
    const a = negotiationArgs("Собери КП на перчатки рабочие: 100 штук по 800, за 5 дней, предоплата");
    expect(a).toMatchObject({ query: "перчатки рабочие", quantity: 100, targetPriceRub: 800, leadDays: 5, payment: "PREPAY" });
    expect(negotiationArgs("поторгуйся за каски 50 шт, нужно до 10 дней").maxPriceRub).toBeUndefined();
  });
});

describe("условия в торге и в КП", () => {
  let buyerId = "";
  let productId = "";

  beforeAll(async () => {
    const pass = await hashPassword("password123");
    buyerId = (await prisma.user.create({ data: { email: `terms-buyer@${W}.test`, name: "Закупщик условия", passwordHash: pass } })).id;
    const u = await prisma.user.create({ data: { email: `terms-seller@${W}.test`, name: "Продавец условия", role: "SELLER", passwordHash: pass } });
    const s = await prisma.sellerProfile.create({ data: { userId: u.id, slug: `terms-seller-${W}`, displayName: "Поставщик условия", isActivated: true } });
    await saveSellerNegotiationPolicy(s.id, u.id, { terms: { standardLeadDays: 10, rushLeadDays: 4, rushSurchargePercent: 5, prepayDiscountPercent: 3, maxDeferralDays: 45, deferralMarkupPercent: 2 } });
    expect((await getSellerNegotiationPolicy(s.id)).terms.standardLeadDays).toBe(10);
    productId = (
      await prisma.product.create({
        data: {
          sellerId: s.id,
          sku: `TERMS-${W}`,
          title: "Огнетушитель условия-тест",
          priceKopecks: 100000,
          status: "ACTIVE",
          inventory: { create: { quantity: 1000, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() } },
        },
      })
    ).id;
  });

  it("срочная поставка с предоплатой: цена и условия попадают в КП", async () => {
    const res = await toolRegistry.get("negotiate_quote")!.execute(
      { userId: buyerId, role: "buyer", traceId: `terms-${W}` },
      { productId, quantity: 100, targetPriceRub: 800, maxPriceRub: 900, leadDays: 5, payment: "PREPAY" }
    );
    expect(res.ok).toBe(true);
    const data = res.data as { unitPriceKopecks: number; finalUnitPriceKopecks: number; quoteId: string; terms: { leadDays: number; adjustmentPercent: number } };
    // +5% срочность −3% предоплата = +2%.
    expect(data.terms).toMatchObject({ leadDays: 5, adjustmentPercent: 2 });
    expect(data.finalUnitPriceKopecks).toBe(Math.round((data.unitPriceKopecks * 1.02) / 100) * 100);
    expect(res.summary).toContain("Условия:");
    const quote = (await listBuyerQuotes(buyerId)).find((q) => q.id === data.quoteId)!;
    expect(quote.unitPriceKopecks).toBe(data.finalUnitPriceKopecks);
    expect(quote).toMatchObject({ leadDays: 5, payment: "PREPAY" });
    expect(quote.termsLines?.length).toBeGreaterThan(0);
  });
});
