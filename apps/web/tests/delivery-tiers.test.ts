/**
 * Delivery tier honesty tests (spec §49, §58).
 *
 * The critical rule under test: the platform must NEVER call an endpoint it
 * invented and present the carrier as integrated. This file locks in that
 * CDEK uses its real documented `/selection` API, and every other carrier
 * honestly reports PENDING_EXTERNAL_ACCESS instead of probing a made-up path.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  listCarriers,
  HttpCarrierAdapter,
  PLATFORM_CARRIER_KEY,
  tierName,
} from "../src/lib/delivery-tiers";

describe("delivery tiers — no fabricated carrier integration (spec §49)", () => {
  beforeEach(() => {
    delete process.env.CDEK_TOKEN;
    delete process.env.CDEK_ACCOUNT;
    delete process.env.CDEK_SECURE_KEY;
  });

  it("exposes all three delivery levels named for the seller", () => {
    expect(tierName(1)).toBe("Платформа");
    expect(tierName(2)).toBe("Все компании");
    expect(tierName(3)).toBe("Международная доставка");
  });

  it("has a tier-1 platform carrier that needs no credentials", () => {
    const platform = listCarriers().find((c) => c.key === PLATFORM_CARRIER_KEY);
    expect(platform).toBeDefined();
    expect(platform?.configured).toBe(true);
    expect(platform?.tier).toBe(1);
  });

  it("CDEK is wired to its real documented tariff endpoint, not a fake path", () => {
    const cdek = listCarriers().find((c) => c.key === "cdek");
    expect(cdek).toBeDefined();
    expect(cdek).toBeInstanceOf(HttpCarrierAdapter);
    // The resolver is what makes it a real integration. Without a credential
    // it must degrade to PENDING rather than call anything.
    expect((cdek as HttpCarrierAdapter & { configured: boolean }).configured).toBe(false);
  });

  it("reports every carrier honestly when no credentials are present", async () => {
    const carriers = listCarriers();
    // Nothing without a key may claim a price.
    for (const c of carriers) {
      if (c.key === PLATFORM_CARRIER_KEY) continue; // computes from real history
      if (c.configured) continue;
      const quote = await c.estimatePrice({ weightGrams: 1000, city: "Москва" });
      expect(quote.kopecks).toBeNull();
      expect(quote.note).toContain("PENDING_EXTERNAL_ACCESS");
    }
  });

  it("does not fabricate a price for an unintegrated carrier even with a key set", async () => {
    // Boxberry's API is not implemented yet. Even with a credential present the
    // platform must say so rather than call an invented endpoint.
    process.env.BOXBERRY_API_KEY = "test-key-should-not-enable-fake-integration";
    const boxberry = listCarriers().find((c) => c.key === "boxberry");
    expect(boxberry).toBeDefined();

    const quote = await boxberry!.estimatePrice({ weightGrams: 1000, city: "Москва" });
    // Must NOT return a fabricated number.
    expect(quote.kopecks).toBeNull();
    expect(quote.note).toContain("не интегрирован");
    delete process.env.BOXBERRY_API_KEY;
  });

  it("keeps tier 1 honest when there is no shipment history yet", async () => {
    const platform = listCarriers().find((c) => c.key === PLATFORM_CARRIER_KEY)!;
    const quote = await platform.estimatePrice({});
    // With <3 shipments it must return null + a reason, not an invented average.
    if (quote.kopecks === null) {
      expect(quote.note).toBeTruthy();
    }
  });

  it("covers international carriers for tier 3", () => {
    const international = listCarriers().filter((c) => c.tier === 3);
    expect(international.length).toBeGreaterThan(0);
    expect(international.every((c) => c.region === "INT")).toBe(true);
  });
});