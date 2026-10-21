import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { createJurySeller, JURY_SHOP_PREFIX } from "../src/lib/domains/jury-seller";
import { isJuryGuestEmail } from "../src/lib/domains/jury-guest";
import { autoConfirmDemoQuote, createQuote, decideQuote, listSellerQuotes } from "../src/lib/domains/b2b-quotes";

const ORIGINAL = process.env.JURY_DEMO;
const rnd = () => randomBytes(4).toString("hex");
const TITLE = "Автоподтверждение тестовый товар";

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JURY_DEMO;
  else process.env.JURY_DEMO = ORIGINAL;
});

async function shop(slug: string) {
  const u = await prisma.user.create({ data: { email: `${slug}@shop.test`, name: slug, role: "SELLER", passwordHash: await hashPassword("password123") } });
  const s = await prisma.sellerProfile.create({ data: { userId: u.id, slug, displayName: slug, isActivated: true } });
  const p = await prisma.product.create({ data: { sellerId: s.id, sku: `T-${slug}`, title: TITLE, priceKopecks: 5000, status: "ACTIVE" } });
  return { sellerId: s.id, productId: p.id };
}

describe("Вход продавцом для жюри", () => {
  it("создаёт демо-магазин с входящим КП, которое продавец подтверждает сам", async () => {
    delete process.env.JURY_DEMO;
    const ip = `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const a = await createJurySeller(ip);
    expect(a.user.role).toBe("SELLER");
    expect(isJuryGuestEmail(a.user.email)).toBe(true);
    const profile = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: a.sellerId } });
    expect(profile.slug.startsWith(JURY_SHOP_PREFIX)).toBe(true);
    const listing = await prisma.listing.findUnique({ where: { productId: a.productId } });
    expect(listing?.isLive).toBe(false);
    expect(a.quote).not.toBeNull();
    const quotes = await listSellerQuotes(a.sellerId);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].status).toBe("AWAITING_SELLER");
    expect(quotes[0].unitPriceKopecks).toBeLessThan(39000);
    const decided = await decideQuote(quotes[0].id, a.sellerId, a.user.id, true);
    expect(decided.status).toBe("SELLER_CONFIRMED");
    expect(await prisma.session.count({ where: { userId: a.user.id, token: a.token } })).toBe(1);
  });

  it("не больше 3 магазинов в час с одного адреса и выключается JURY_DEMO=0", async () => {
    delete process.env.JURY_DEMO;
    const ip = `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 3; i += 1) await createJurySeller(ip);
    await expect(createJurySeller(ip)).rejects.toThrow();
    process.env.JURY_DEMO = "0";
    await expect(createJurySeller("10.4.0.1")).rejects.toThrow();
  });
});

describe("Демо-оптовик подтверждает КП сам", () => {
  const buyer = async () => (await prisma.user.create({ data: { email: `b-${rnd()}@buyer.test`, name: "Закупщик", passwordHash: await hashPassword("password123") } })).id;
  const quoteFor = async (sellerId: string, productId: string, buyerId: string) =>
    createQuote({ productId, sellerId, buyerId, title: TITLE, quantity: 10, unitPriceKopecks: 4500, listPriceKopecks: 5000, totalKopecks: 45000, discountPercent: 10, rounds: 2, chain: "тест" });

  it("у demo-b2b-* КП сразу подтверждено", async () => {
    delete process.env.JURY_DEMO;
    const s = await shop(`demo-b2b-t${rnd()}`);
    const q = await quoteFor(s.sellerId, s.productId, await buyer());
    expect(await autoConfirmDemoQuote(q)).toBe(true);
    expect((await listSellerQuotes(s.sellerId))[0].status).toBe("SELLER_CONFIRMED");
  });

  it("у обычного продавца и при JURY_DEMO=0 решает человек", async () => {
    delete process.env.JURY_DEMO;
    const real = await shop(`real-${rnd()}`);
    const q1 = await quoteFor(real.sellerId, real.productId, await buyer());
    expect(await autoConfirmDemoQuote(q1)).toBe(false);
    expect((await listSellerQuotes(real.sellerId))[0].status).toBe("AWAITING_SELLER");

    process.env.JURY_DEMO = "0";
    const demo = await shop(`demo-b2b-t${rnd()}`);
    const q2 = await quoteFor(demo.sellerId, demo.productId, await buyer());
    expect(await autoConfirmDemoQuote(q2)).toBe(false);
    expect((await listSellerQuotes(demo.sellerId))[0].status).toBe("AWAITING_SELLER");
  });
});
