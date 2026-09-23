import { describe, it, expect } from "vitest";
import { computeAvailability, LISTING_DEFAULT_DAYS } from "../src/lib/domains/inventory";

describe("availability computation (spec §10)", () => {
  it("reports in-stock confirmed items as available", () => {
    expect(computeAvailability(10, true, new Date(Date.now() + 864e5))).toBe("AVAILABLE");
  });

  it("degrades low stock to limited", () => {
    expect(computeAvailability(2, true, new Date(Date.now() + 864e5))).toBe("LIMITED");
  });

  it("reports zero stock as out of stock", () => {
    expect(computeAvailability(0, true, new Date(Date.now() + 864e5))).toBe("OUT_OF_STOCK");
  });

  it("never reports availability without seller confirmation", () => {
    const future = new Date(Date.now() + 864e5);
    expect(computeAvailability(10, false, future)).toBe("UNKNOWN");
    expect(computeAvailability(0, false, future)).toBe("OUT_OF_STOCK");
  });

  it("expires unconfirmed listings", () => {
    const past = new Date(Date.now() - 864e5);
    expect(computeAvailability(10, true, past)).toBe("UNKNOWN");
  });

  it("uses a configurable default listing window", () => {
    expect(LISTING_DEFAULT_DAYS).toBeGreaterThanOrEqual(7);
  });
});

describe("public catalog visibility (spec §9)", () => {
  async function makeSeller() {
    const { prisma } = await import("../src/lib/prisma");
    const n = Math.random().toString(36).slice(2, 8);
    const user = await prisma.user.create({
      data: { name: "Витрина", email: `cat-${n}@test.local`, passwordHash: "x", role: "SELLER" },
    });
    return prisma.sellerProfile.create({
      data: { userId: user.id, displayName: "Витрина", slug: `vitrina-${n}` },
    });
  }

  it("never exposes a HIDDEN product through the public lookup", async () => {
    const { prisma } = await import("../src/lib/prisma");
    const seller = await makeSeller();
    const hidden = await prisma.product.create({
      data: {
        sellerId: seller.id,
        title: "Скрытый товар t1",
        sku: "hidden-t1",
        seoSlug: "hidden-t1",
        priceKopecks: 100000,
        status: "HIDDEN",
      },
    });
    try {
      const { getPublicProduct } = await import("../src/lib/domains/catalog");
      expect(await getPublicProduct(hidden.id)).toBeNull();
      expect(await getPublicProduct(hidden.sku)).toBeNull();
    } finally {
      await prisma.product.delete({ where: { id: hidden.id } });
      await prisma.sellerProfile.delete({ where: { id: seller.id } });
      await prisma.user.delete({ where: { id: seller.userId } });
    }
  });

  it("exposes an ACTIVE product publicly", async () => {
    const { prisma } = await import("../src/lib/prisma");
    const seller = await makeSeller();
    const active = await prisma.product.create({
      data: {
        sellerId: seller.id,
        title: "Активный товар t1",
        sku: "active-t1",
        seoSlug: "active-t1",
        priceKopecks: 100000,
        status: "ACTIVE",
      },
    });
    try {
      const { getPublicProduct } = await import("../src/lib/domains/catalog");
      expect((await getPublicProduct(active.id))?.id).toBe(active.id);
    } finally {
      await prisma.product.delete({ where: { id: active.id } });
      await prisma.sellerProfile.delete({ where: { id: seller.id } });
      await prisma.user.delete({ where: { id: seller.userId } });
    }
  });
});
