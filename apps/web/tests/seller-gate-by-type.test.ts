import { describe, expect, it } from "vitest";
import { taxStatusOk } from "../src/lib/domains/seller-onboarding";

describe("допуск к торговле по типу продавца", () => {
  it("самозанятому нужен именно НПД", () => {
    expect(taxStatusOk({ sellerType: "SELF_EMPLOYED", businessStatus: "VERIFIED", npdStatus: "UNVERIFIED" })).toBe(false);
    expect(taxStatusOk({ sellerType: "SELF_EMPLOYED", businessStatus: "UNVERIFIED", npdStatus: "VERIFIED" })).toBe(true);
  });
  it("ИП и организации нужна регистрация, НПД не засчитывается", () => {
    expect(taxStatusOk({ sellerType: "IP", businessStatus: "VERIFIED", npdStatus: "UNVERIFIED" })).toBe(true);
    expect(taxStatusOk({ sellerType: "COMPANY", businessStatus: "UNVERIFIED", npdStatus: "VERIFIED" })).toBe(false);
  });
  it("физлицо и неизвестный тип: как раньше, любой из двух", () => {
    expect(taxStatusOk({ sellerType: "INDIVIDUAL", businessStatus: "VERIFIED", npdStatus: "UNVERIFIED" })).toBe(true);
    expect(taxStatusOk({ businessStatus: "UNVERIFIED", npdStatus: "VERIFIED" })).toBe(true);
    expect(taxStatusOk({ sellerType: null, businessStatus: "UNVERIFIED", npdStatus: "UNVERIFIED" })).toBe(false);
  });
});
