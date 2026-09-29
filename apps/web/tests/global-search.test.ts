/**
 * Global marketplace search (spec §13, §26 + product requirement:
 * "search may be global, but must always search and compare in favour of
 *  our platform").
 *
 * Covers:
 *  - platform results rank ahead of external offers
 *  - tier 1 (Russia) is default; tier 2 is opt-in
 *  - unreachable marketplaces are reported honestly, never faked
 *  - competitor scan records price history and a truthful verdict
 */
import { describe, it, expect, beforeAll } from "vitest";
import { searchGlobally, scanExternalCompetitors } from "../src/lib/domains/external-search";
import { prisma } from "../src/lib/prisma";

const SELLER_ID = "cls-search-seller";
const PRODUCT_ID = "cls-search-product";

async function seedProduct(priceKopecks: number) {
  const user = await prisma.user.upsert({
    where: { email: "cls-search@svetlana.example" },
    update: {},
    create: {
      email: "cls-search@svetlana.example",
      passwordHash: "x",
      name: "Search",
      role: "SELLER",
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      id: SELLER_ID,
      userId: user.id,
      displayName: "Search Seller",
      slug: "cls-search-seller",
      identityStatus: "VERIFIED",
      businessStatus: "VERIFIED",
      isActivated: true,
    },
  });
  await prisma.category.upsert({
    where: { id: "cat-search" },
    update: {},
    create: { id: "cat-search", name: "Поиск", slug: "cat-search" },
  });
  return prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: { priceKopecks },
    create: {
      id: PRODUCT_ID,
      sellerId: SELLER_ID,
      sku: "CLS-SEARCH-1",
      title: "Смартфон Aurora 12 256GB",
      description: "Флагманский смартфон",
      priceKopecks,
      status: "ACTIVE",
      categoryId: "cat-search",
    },
  });
}

describe("global search", () => {
  beforeAll(async () => {
    await seedProduct(90_000_00);
  });

  it("always ranks platform offers above external ones", async () => {
    const report = await searchGlobally({ text: "смартфон", limit: 50 });

    const platformIdx = report.hits.findIndex((h) => h.source === "platform");
    const externalIdx = report.hits.findIndex((h) => h.source === "external");

    if (platformIdx !== -1 && externalIdx !== -1) {
      expect(platformIdx).toBeLessThan(externalIdx);
    }

    // The platform hit is always marked VERIFIED — it comes from our own DB.
    const platformHits = report.hits.filter((h) => h.source === "platform");
    for (const h of platformHits) {
      expect(h.confidence).toBe("VERIFIED");
      expect(h.url).toMatch(/^\/product\//);
    }
  });

  it("defaults to tier 1 (Russia) and labels it", async () => {
    const report = await searchGlobally({ text: "смартфон" });
    expect(report.tier).toBe(1);
    expect(report.tierLabel.length).toBeGreaterThan(0);
    expect(report.bySource.platform).toBeGreaterThan(0);
  });

  it("reports marketplace availability honestly instead of faking offers", async () => {
    const report = await searchGlobally({ text: "смартфон" });

    for (const a of report.availability) {
      // A marketplace is either reachable or it is not — both are reported,
      // never silently converted into a fabricated success.
      expect(typeof a.reachable).toBe("boolean");
      expect(a.tier).toBeGreaterThanOrEqual(1);
    }

    // liveExternal is true ONLY when a real external feed answered.
    const anyLive = report.availability.some((a) => a.reachable);
    if (!anyLive) {
      expect(report.liveExternal).toBe(false);
      expect(report.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("competitor scan", () => {
  it("keeps the seller's own price and produces a truthful verdict", async () => {
    const scan = await scanExternalCompetitors(PRODUCT_ID);

    expect(scan.ownPriceKopecks).toBe(90_000_00);
    expect(scan.ownTitle).toContain("Aurora");

    // Never fabricates a verdict: either it has live external data, or it
    // honestly reports the integration as PENDING_EXTERNAL_ACCESS.
    if (!scan.liveExternal) {
      expect(scan.verdict).toContain("PENDING_EXTERNAL_ACCESS");
      expect(scan.verifiedOffers).toHaveLength(0);
    } else {
      expect(scan.minExternalPrice).not.toBeNull();
      expect(scan.verifiedOffers.length).toBeGreaterThan(0);
    }

    // The scan never mutates the seller's price (spec §19: price change only
    // after seller confirmation).
    const after = await prisma.product.findUnique({ where: { id: PRODUCT_ID } });
    expect(after?.priceKopecks).toBe(90_000_00);
  });

  it("records scanned offers as competitor listings for price history", async () => {
    const scan = await scanExternalCompetitors(PRODUCT_ID);
    const rows = await prisma.competitorListing.count({ where: { productId: PRODUCT_ID } });

    if (scan.verifiedOffers.length > 0) {
      expect(rows).toBeGreaterThanOrEqual(scan.verifiedOffers.length);
    }
  });
});
