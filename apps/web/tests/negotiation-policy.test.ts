import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";
import { toolRegistry } from "../src/lib/ai/tools";
import { normalizeNegotiationPolicy, defaultNegotiationPolicy, getSellerNegotiationPolicy, saveSellerNegotiationPolicy } from "../src/lib/domains/negotiation-policy";
import { negotiationArgs, isNegotiationRequest } from "../src/lib/ai/negotiation-command";
import { MockAiProvider } from "../src/lib/ai/providers/mock";
import { resolveToolArgs, planReferenceAction } from "../src/lib/ai/references";

const W = process.env.VITEST_WORKER_ID ?? "0";

describe("правила торга продавца: проверка ввода", () => {
  it("по умолчанию: 15% максимум, 5% торга, три уровня скидок за объём", () => {
    const p = defaultNegotiationPolicy();
    expect(p).toMatchObject({ enabled: true, maxDiscountPercent: 15, negotiablePercent: 5, minOrderQty: 1, custom: false });
    expect(p.volumeTiers.length).toBe(3);
  });

  it("мусор и выход за пределы приводятся к безопасным значениям", () => {
    const p = normalizeNegotiationPolicy({
      maxDiscountPercent: 99,
      negotiablePercent: 500,
      minOrderQty: -5,
      volumeTiers: [{ minQty: 1, discountPercent: 5 }, { minQty: 50, discountPercent: 90 }, { minQty: 50, discountPercent: 3 }, "x", { minQty: 10 }],
    });
    expect(p.maxDiscountPercent).toBe(70);
    expect(p.negotiablePercent).toBe(70);
    expect(p.minOrderQty).toBe(1);
    // minQty 1 отброшен, дубль 50 отброшен, уровень без скидки отброшен, скидка срезана до максимума.
    expect(p.volumeTiers).toEqual([{ minQty: 50, discountPercent: 70 }]);
    expect(normalizeNegotiationPolicy({ enabled: false }).enabled).toBe(false);
  });
});

describe("правила торга продавца: хранение и применение агентом", () => {
  let sellerId = "";
  let userId = "";
  let productId = "";
  const ctx = { userId: "", role: "buyer", traceId: `negp-${W}` };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `negp-seller@${W}.test`, name: "Оптовик Правила", role: "SELLER", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    const seller = await prisma.sellerProfile.create({
      data: { userId: user.id, slug: `negp-seller-${W}`, displayName: "Оптовик Правила", isActivated: true },
    });
    sellerId = seller.id;
    const product = await prisma.product.create({
      data: {
        sellerId,
        sku: `NEGP-${W}`,
        title: "Каски защитные",
        priceKopecks: 100000,
        status: "ACTIVE",
        inventory: { create: { quantity: 1000, availability: "AVAILABLE", confirmedBySeller: true, confirmedAt: new Date() } },
      },
    });
    productId = product.id;
  });

  it("пока продавец ничего не задал, действуют правила по умолчанию", async () => {
    expect((await getSellerNegotiationPolicy(sellerId)).custom).toBe(false);
  });

  it("сохраняет правила, пишет аудит, агент торгуется в их пределах", async () => {
    const saved = await saveSellerNegotiationPolicy(sellerId, userId, { maxDiscountPercent: 12, negotiablePercent: 2, minOrderQty: 10, volumeTiers: [{ minQty: 100, discountPercent: 10 }] });
    expect(saved).toMatchObject({ maxDiscountPercent: 12, negotiablePercent: 2, custom: true });
    expect(await getSellerNegotiationPolicy(sellerId)).toMatchObject({ maxDiscountPercent: 12, negotiablePercent: 2, minOrderQty: 10 });
    const log = await prisma.auditLog.findFirst({ where: { action: "seller.negotiation_policy.update", targetId: sellerId } });
    expect(log).not.toBeNull();

    const tool = toolRegistry.get("negotiate_quote")!;
    const res = await tool.execute(ctx, { productId, quantity: 100, targetPriceRub: 800, maxPriceRub: 900 });
    expect(res.ok).toBe(true);
    const data = res.data as { status: string; unitPriceKopecks: number; sellerRules: string };
    expect(data.status).toBe("AGREED");
    expect(data.sellerRules).toBe("seller");
    // Пол продавца: 10% за объём + 2% торга = 880 ₽.
    expect(data.unitPriceKopecks).toBeGreaterThanOrEqual(88000);
    expect(res.summary).toContain("Ход торга");

    const small = await tool.execute(ctx, { productId, quantity: 5 });
    expect(small.data).toMatchObject({ status: "NO_DEAL" });
  });

  it("продавец выключил торг: агент не торгуется, цена по прайсу", async () => {
    await saveSellerNegotiationPolicy(sellerId, userId, { enabled: false });
    const res = await toolRegistry.get("negotiate_quote")!.execute(ctx, { productId, quantity: 100 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("по прайсу");
    await saveSellerNegotiationPolicy(sellerId, userId, { enabled: true });
  });
});

describe("торг в чате без внешней модели", () => {
  it("понимает просьбу и вынимает количество, цель и потолок", () => {
    const text = "Поторгуйся за первый: 100 штук, хочу по 800 ₽, максимум 900";
    expect(isNegotiationRequest(text)).toBe(true);
    expect(negotiationArgs(text)).toMatchObject({ quantity: 100, targetPriceRub: 800, maxPriceRub: 900 });
    expect(negotiationArgs("нужно 1 000 шт, оптовая цена по 950 руб до 990")).toMatchObject({ quantity: 1000, targetPriceRub: 950, maxPriceRub: 990 });
    expect(negotiationArgs("КП на 50 шт").targetPriceRub).toBeUndefined();
    expect(isNegotiationRequest("найди чайник")).toBe(false);
  });

  it("встроенная Светлана вызывает negotiate_quote, а не поиск за рубежом", async () => {
    const provider = new MockAiProvider();
    const res = await provider.complete({
      messages: [{ role: "user", content: "Поторгуйся оптом: 100 штук по 800 ₽, максимум 900" }],
      taskClass: "reasoning",
      traceId: "neg-mock",
    } as Parameters<MockAiProvider["complete"]>[0]);
    expect(res.toolCalls?.[0]?.name).toBe("negotiate_quote");
    expect(res.toolCalls?.[0]?.arguments).toMatchObject({ quantity: 100, targetPriceRub: 800, maxPriceRub: 900 });
  });

  it("«поторгуйся за второй» подставляет показанный товар", () => {
    const shown = [{ productId: "p-first-123", title: "Перчатки" }, { productId: "p-second-456", title: "Каски" }];
    const planned = planReferenceAction("Поторгуйся за второй, 50 штук", shown);
    expect(planned).toMatchObject({ tool: "negotiate_quote", args: { productId: "p-second-456", quantity: 50 } });
    expect(resolveToolArgs("negotiate_quote", { quantity: 100 }, "поторгуйся за первый 100 штук", shown)).toMatchObject({ productId: "p-first-123", quantity: 100 });
  });
});
