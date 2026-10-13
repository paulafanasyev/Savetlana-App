import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { addToCart } from "../src/lib/domains/cart";
import { publishProblems } from "../src/lib/domains/publish-check";

async function fixture(quantity: number) {
  const s = Math.random().toString(36).slice(2);
  const buyer = await prisma.user.create({ data: { email: `cv-b-${s}@test.local`, passwordHash: "x" } });
  const sellerUser = await prisma.user.create({ data: { email: `cv-s-${s}@test.local`, passwordHash: "x", role: "SELLER" } });
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, slug: `cv-${s}`, displayName: "Лавка", isActivated: true } });
  const product = await prisma.product.create({
    data: {
      sellerId: seller.id, sku: `CV-${s}`, title: "Футболка", priceKopecks: 100_000, status: "ACTIVE",
      inventory: { create: { quantity } },
      variants: { create: [{ name: "Синяя, M", priceDelta: 5_000 }] },
    },
    include: { variants: true },
  });
  return { buyer, product };
}

describe("корзина: варианты и наличие", () => {
  it("вариант попадает в корзину со своей ценой и названием", async () => {
    const { buyer, product } = await fixture(3);
    const view = await addToCart(buyer.id, product.id, 1, product.variants[0].id);
    expect(view.lines[0].priceKopecks).toBe(105_000);
    expect(view.lines[0].title).toContain("Синяя, M");
    expect(view.lines[0].variantId).toBe(product.variants[0].id);
  });

  it("нельзя положить товар, которого нет, и больше остатка", async () => {
    const empty = await fixture(0);
    await expect(addToCart(empty.buyer.id, empty.product.id, 1)).rejects.toThrow(/закончился/);
    const two = await fixture(2);
    await addToCart(two.buyer.id, two.product.id, 2);
    await expect(addToCart(two.buyer.id, two.product.id, 1)).rejects.toThrow(/только 2/);
  });

  it("товар без фото и остатка нельзя опубликовать", async () => {
    const { product } = await fixture(0);
    const problems = await publishProblems(prisma, product.id);
    expect(problems.join(" ")).toMatch(/фото/);
    expect(problems.join(" ")).toMatch(/остаток/);
    await prisma.productImage.create({ data: { productId: product.id, url: "/api/storage/public/x.jpg" } });
    await prisma.inventory.update({ where: { productId: product.id }, data: { quantity: 4 } });
    expect(await publishProblems(prisma, product.id)).toEqual([]);
  });
});
