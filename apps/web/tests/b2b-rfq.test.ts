import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { rfqStems } from "../src/lib/ai/tools/negotiation-tool";
import { saveSellerNegotiationPolicy } from "../src/lib/domains/negotiation-policy";
import { listBuyerQuotes } from "../src/lib/domains/b2b-quotes";
import { MockAiProvider } from "../src/lib/ai/providers/mock";

const W = process.env.VITEST_WORKER_ID ?? "0";

describe("запрос цены у нескольких продавцов (реверсивный аукцион)", () => {
  let buyerId = "";
  const sellers: Record<string, { sellerId: string; userId: string; productId: string }> = {};

  beforeAll(async () => {
    const pass = await hashPassword("password123");
    buyerId = (await prisma.user.create({ data: { email: `rfq-buyer@${W}.test`, name: "Закупщик RFQ", passwordHash: pass } })).id;
    const make = async (key: string, price: number) => {
      const u = await prisma.user.create({ data: { email: `rfq-${key}@${W}.test`, name: `Продавец ${key}`, role: "SELLER", passwordHash: pass } });
      const s = await prisma.sellerProfile.create({ data: { userId: u.id, slug: `rfq-${key}-${W}`, displayName: `Поставщик ${key.toUpperCase()}`, isActivated: true } });
      const p = await prisma.product.create({
        data: {
          sellerId: s.id,
          sku: `RFQ-${key}-${W}`,
          title: `Респиратор складной ФФП-тест ${key.toUpperCase()}`,
          priceKopecks: price,
          status: "ACTIVE",
          inventory: { create: { quantity: 5000, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() } },
        },
      });
      sellers[key] = { sellerId: s.id, userId: u.id, productId: p.id };
    };
    await make("a", 100000);
    await make("b", 95000);
    await make("c", 110000);
    await saveSellerNegotiationPolicy(sellers.b.sellerId, sellers.b.userId, { enabled: false });
    await saveSellerNegotiationPolicy(sellers.c.sellerId, sellers.c.userId, { maxDiscountPercent: 5, negotiablePercent: 0, volumeTiers: [] });
  });

  it("основы слов без окончаний", () => {
    expect(rfqStems("Каски защитные")).toEqual(["каск", "защитн"]);
    expect(rfqStems("перчатки рабочие")).toEqual(["перчат", "рабоч"]);
  });

  it("торгуется с каждым продавцом, выбирает лучшее и отправляет КП победителю", async () => {
    const res = await toolRegistry.get("negotiate_quote")!.execute(
      { userId: buyerId, role: "buyer", traceId: `rfq-${W}` },
      { query: "респираторы складные ффп-тест", quantity: 100, targetPriceRub: 800, maxPriceRub: 900 }
    );
    expect(res.ok).toBe(true);
    const data = res.data as { mode: string; offers: { productId: string; status: string; priceKopecks: number }[]; winnerProductId: string; quoteId: string };
    expect(data.mode).toBe("rfq");
    expect(data.offers).toHaveLength(3);
    expect(data.winnerProductId).toBe(sellers.a.productId);
    const byId = Object.fromEntries(data.offers.map((o) => [o.productId, o]));
    expect(byId[sellers.a.productId].status).toBe("AGREED");
    expect(byId[sellers.a.productId].priceKopecks).toBeLessThanOrEqual(90000);
    expect(byId[sellers.b.productId].status).toBe("NO_NEGOTIATION");
    expect(byId[sellers.c.productId].status).toBe("NO_DEAL");
    expect(res.summary).toContain("лучшее");
    const quotes = await listBuyerQuotes(buyerId);
    expect(quotes.find((q) => q.id === data.quoteId)?.sellerId).toBe(sellers.a.sellerId);
  });

  it("ничего не нашлось: честно говорит об этом", async () => {
    const res = await toolRegistry.get("negotiate_quote")!.execute({ userId: buyerId, role: "buyer", traceId: `rfq2-${W}` }, { query: "несуществующийтоварzzz", quantity: 10 });
    expect(res.ok).toBe(false);
  });

  it("встроенная Светлана понимает «собери КП на …»", async () => {
    const res = await new MockAiProvider().complete({
      messages: [{ role: "user", content: "Собери КП на респираторы: 100 штук, хочу по 800 ₽, максимум 900" }],
      taskClass: "reasoning",
      traceId: "rfq-mock",
    } as Parameters<MockAiProvider["complete"]>[0]);
    expect(res.toolCalls?.[0]?.name).toBe("negotiate_quote");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ query: "респираторы", quantity: 100, targetPriceRub: 800, maxPriceRub: 900 });
  });
});
