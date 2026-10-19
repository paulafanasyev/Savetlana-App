import { describe, expect, it } from "vitest";
import { checkStatusLabel, isDemoSeller, sellerBadges, shownStatus } from "../src/lib/domains/seller-trust-display";

const verified = { sellerType: "SELF_EMPLOYED", identityStatus: "VERIFIED", businessStatus: "VERIFIED", npdStatus: "VERIFIED" };

describe("демо-магазины без ложных галочек", () => {
  it("у демо-магазина нет отметок, даже если в базе VERIFIED", () => {
    expect(sellerBadges({ ...verified, slug: "demo-home" })).toEqual([]);
    expect(sellerBadges({ ...verified, slug: "uyutny-dom" }).map((b) => b.key)).toContain("verified_seller");
    expect(sellerBadges(verified).map((b) => b.key)).toContain("verified_seller");
  });
  it("вместо «проверено» пишем «демо, без проверки»", () => {
    expect(checkStatusLabel(shownStatus({ slug: "demo-tech" }, "VERIFIED"))).toBe("демо, без проверки");
    expect(checkStatusLabel(shownStatus({ slug: "real-shop" }, "VERIFIED"))).toBe("✓ проверено");
  });
  it("демо определяется только по приставке slug", () => {
    expect(isDemoSeller({ slug: "demo-sport" })).toBe(true);
    expect(isDemoSeller({ slug: "my-demo-shop" })).toBe(false);
    expect(isDemoSeller({ slug: null })).toBe(false);
    expect(isDemoSeller({})).toBe(false);
  });
});
