import { describe, expect, it } from "vitest";
import { sellerInnStatus } from "../src/lib/domains/seller-inn-report";

describe("отчёт по ИНН продавцов", () => {
  it("ИНН юрлица важнее ИНН профиля", () => {
    expect(sellerInnStatus({ inn: "500100732259", companyInn: "7707083893" })).toEqual({ inn: "7707083893", source: "company", status: "OK" });
  });

  it("без юрлица берётся ИНН профиля", () => {
    expect(sellerInnStatus({ inn: "500100732259", companyInn: null })).toEqual({ inn: "500100732259", source: "profile", status: "OK" });
  });

  it("пустой ИНН: не указан, неверная контрольная сумма: ошибка", () => {
    expect(sellerInnStatus({ inn: null })).toEqual({ inn: null, source: null, status: "MISSING" });
    expect(sellerInnStatus({ inn: "  ", companyInn: "" })).toEqual({ inn: null, source: null, status: "MISSING" });
    expect(sellerInnStatus({ inn: "7707083894" }).status).toBe("INVALID");
  });
});
