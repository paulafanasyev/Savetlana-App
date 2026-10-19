import { describe, expect, it } from "vitest";
import { sellerBadges, taxCheck } from "../src/lib/domains/seller-trust-display";

const base = { identityStatus: "VERIFIED", businessStatus: "UNVERIFIED", npdStatus: "UNVERIFIED" };
const keys = (s: Parameters<typeof sellerBadges>[0]) => sellerBadges(s).map((b) => b.key);

describe("значки продавца по типу", () => {
  it("самозанятый с непроверенным НПД не «проверенный» и не «ИП», даже если businessStatus VERIFIED", () => {
    expect(keys({ ...base, sellerType: "SELF_EMPLOYED", businessStatus: "VERIFIED" })).toEqual(["identity"]);
  });
  it("самозанятый с НПД из ФНС", () => {
    expect(keys({ ...base, sellerType: "SELF_EMPLOYED", npdStatus: "VERIFIED" })).toEqual(["verified_seller", "npd_fns", "identity"]);
  });
  it("ИП и организация проверяются по регистрации, НПД им не засчитывается", () => {
    expect(keys({ ...base, sellerType: "IP", businessStatus: "VERIFIED" })).toEqual(["verified_seller", "business", "identity"]);
    expect(keys({ ...base, sellerType: "COMPANY", npdStatus: "VERIFIED" })).toEqual(["identity"]);
    expect(sellerBadges({ ...base, sellerType: "COMPANY", businessStatus: "VERIFIED" }).find((b) => b.key === "business")?.label).toBe("Организация подтверждена");
  });
  it("физлицо: только личность, налогового статуса нет", () => {
    expect(keys({ ...base, sellerType: "INDIVIDUAL", businessStatus: "VERIFIED", npdStatus: "VERIFIED" })).toEqual(["identity"]);
    expect(taxCheck({ ...base, sellerType: "INDIVIDUAL" })).toBe(null);
  });
  it("что проверяется у каждого типа", () => {
    expect(taxCheck({ ...base, sellerType: "SELF_EMPLOYED", npdStatus: "PENDING" })).toEqual({ label: "Статус самозанятого (ФНС)", status: "PENDING" });
    expect(taxCheck({ ...base, sellerType: "IP", businessStatus: "VERIFIED" })?.status).toBe("VERIFIED");
  });
});
