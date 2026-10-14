import { describe, expect, it } from "vitest";
import { applyReceiptSettings, isValidInn, receiptInnBlocker } from "../src/lib/domains/receipt";

describe("ИНН продавца для чеков 54-ФЗ", () => {
  it("проверяется контрольная сумма, а не только длина", () => {
    expect(isValidInn("7707083893")).toBe(true);
    expect(isValidInn("500100732259")).toBe(true);
    expect(isValidInn("7707083894")).toBe(false);
    expect(isValidInn("1234567890")).toBe(false);
    expect(isValidInn("500100732258")).toBe(false);
    expect(isValidInn(null)).toBe(false);
  });

  it("без агентских чеков ИНН не мешает торговать", () => {
    expect(receiptInnBlocker(null, {})).toBeNull();
    expect(receiptInnBlocker("1234567890", {})).toBeNull();
  });

  it("с агентскими чеками продавец без верного ИНН блокируется", () => {
    expect(receiptInnBlocker(null, { agentType: "agent" })).toMatch(/ИНН/);
    expect(receiptInnBlocker("7707083894", { agentType: "agent" })).toMatch(/ИНН/);
    expect(receiptInnBlocker("7707083893", { agentType: "agent" })).toBeNull();
  });

  it("чек с ИНН, у которого неверная контрольная сумма, не строится", () => {
    const receipt = { customer: { email: "a@b.ru" }, items: [] };
    expect(() => applyReceiptSettings(receipt, { agentType: "agent", measure: false }, { name: "ООО", inn: "7707083894" })).toThrow(/ИНН/);
  });
});
