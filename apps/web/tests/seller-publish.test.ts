import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { problemsOf } from "../src/lib/domains/publish-check";
import { computeAvailability } from "../src/lib/domains/inventory";
import { planDraftPublish, publishDrafts, publishGateReason } from "../src/lib/domains/seller-publish";

describe("массовая публикация: правила", () => {
  it("те же требования, что у одиночной публикации", () => {
    expect(problemsOf({ priceKopecks: 199_000, imageCount: 1, quantity: 3 })).toEqual([]);
    expect(problemsOf({ priceKopecks: 50, imageCount: 0, quantity: 0 })).toEqual([
      "укажите цену от 1 ₽",
      "добавьте хотя бы одно фото",
      "укажите остаток на складе",
    ]);
    expect(problemsOf({ priceKopecks: 100, imageCount: 2, quantity: undefined })).toEqual(["укажите остаток на складе"]);
  });

  it("непроверенному продавцу объясняет, что сделать", () => {
    expect(publishGateReason({ active: true, blockers: [] })).toBeNull();
    expect(publishGateReason({ active: false, blockers: ["нет ИНН"], nextStep: "заполните реквизиты" })).toContain("нет ИНН");
  });
});

describe("массовая публикация: база", () => {
  it("публикует только готовые черновики своего магазина", async () => {
    const tag = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({ data: { email: `${tag}@test.ru`, passwordHash: "x", role: "SELLER" } });
    const seller = await prisma.sellerProfile.create({ data: { userId: user.id, slug: tag, displayName: "Тест публикации" } });
    const other = await prisma.user.create({ data: { email: `${tag}-o@test.ru`, passwordHash: "x", role: "SELLER" } });
    const otherSeller = await prisma.sellerProfile.create({ data: { userId: other.id, slug: `${tag}-o`, displayName: "Чужой" } });

    const make = async (sellerId: string, n: number, opts: { image: boolean; quantity: number }) => {
      const product = await prisma.product.create({
        data: { sellerId, sku: `${tag}-${sellerId.slice(-4)}-${n}`, title: `Товар ${n}`, seoSlug: `${tag}-${sellerId.slice(-4)}-${n}`, priceKopecks: 150_000, status: "DRAFT", attributes: "{}", keywords: "[]" },
      });
      if (opts.image) await prisma.productImage.create({ data: { productId: product.id, url: "https://example.ru/1.jpg", isPrimary: true, position: 0 } });
      await prisma.inventory.create({ data: { productId: product.id, quantity: opts.quantity, confirmedBySeller: false, availability: computeAvailability(opts.quantity, false, null) } });
      return product;
    };
    const good = await make(seller.id, 1, { image: true, quantity: 2 });
    const noPhoto = await make(seller.id, 2, { image: false, quantity: 2 });
    const foreign = await make(otherSeller.id, 3, { image: true, quantity: 2 });

    const plan = await planDraftPublish(seller.id);
    expect(plan.drafts).toBe(2);
    expect(plan.ready.map((p) => p.productId)).toEqual([good.id]);
    expect(plan.blocked[0]).toMatchObject({ productId: noPhoto.id, problems: ["добавьте хотя бы одно фото"] });

    const result = await publishDrafts({ sellerId: seller.id, actorId: user.id, productIds: [good.id, noPhoto.id, foreign.id, good.id] });
    expect(result.published).toBe(1);
    expect(result.skipped.map((s) => s.productId).sort()).toEqual([foreign.id, noPhoto.id].sort());

    const after = await prisma.product.findMany({ where: { id: { in: [good.id, noPhoto.id, foreign.id] } }, include: { listing: true } });
    const byId = new Map(after.map((p) => [p.id, p]));
    expect(byId.get(good.id)?.status).toBe("ACTIVE");
    expect(byId.get(good.id)?.listing?.isLive).toBe(true);
    expect(byId.get(noPhoto.id)?.status).toBe("DRAFT");
    expect(byId.get(foreign.id)?.status).toBe("DRAFT");
    expect(await prisma.listingHistory.count({ where: { productId: good.id, action: "PUBLISHED" } })).toBe(1);

    // Повторный заход ничего не публикует второй раз.
    const again = await publishDrafts({ sellerId: seller.id, actorId: user.id, productIds: [good.id] });
    expect(again).toMatchObject({ published: 0, skipped: [{ productId: good.id, problems: ["товар уже не черновик"] }] });
  });
});
