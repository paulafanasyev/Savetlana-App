import { describe, expect, it } from "vitest";
import { isValidAccount, isValidCorrAccount, isValidInn, maskAccount, validateBankDetails } from "../src/lib/domains/bank-details";
import { encodeCp1251, registry1C, registryCsv, type RegistryRow } from "../src/lib/domains/payout-registry";

// Реальные БИК и корр. счёт Сбербанка; расчётный счёт с правильным контрольным ключом.
const good = {
  recipientName: "ИП Иванова Анна Сергеевна",
  inn: "500100732259",
  bik: "044525225",
  bankName: "ПАО Сбербанк",
  corrAccount: "30101810400000000225",
  account: "40817810438000000001",
};

describe("реквизиты для выплат", () => {
  it("принимает правильные реквизиты", () => {
    expect(isValidInn("7707083893")).toBe(true);
    expect(isValidInn("500100732259")).toBe(true);
    expect(isValidCorrAccount(good.corrAccount, good.bik)).toBe(true);
    expect(isValidAccount(good.account, good.bik)).toBe(true);
    const r = validateBankDetails({ ...good, account: "4081 7810 4380 0000 0001" }, "500100732259");
    expect(r.details?.account).toBe(good.account);
    expect(Object.keys(r.errors).length).toBe(0);
  });

  it("ловит опечатку в счёте, БИК и ИНН", () => {
    expect(isValidAccount("40817810538000000001", good.bik)).toBe(false);
    expect(isValidInn("7707083894")).toBe(false);
    const r = validateBankDetails({ ...good, bik: "123", account: "1" }, null);
    expect(r.details).toBe(undefined);
    expect(Boolean(r.errors.bik && r.errors.account)).toBe(true);
  });

  it("не даёт перенаправить выплату на чужой ИНН", () => {
    const r = validateBankDetails(good, "7707083893");
    expect(r.errors.inn).toBe("ИНН получателя должен совпадать с ИНН вашего магазина");
  });

  it("прячет номер счёта", () => {
    expect(maskAccount(good.account)).toBe("•••• 0001");
  });
});

const rows: RegistryRow[] = [
  { payoutId: "payout_abcdef12", sellerId: "s1", sellerName: "Чайники", amountKopecks: 123456, createdAt: new Date("2026-10-14T10:00:00Z"), details: { ...good } },
  { payoutId: "payout_nodetails", sellerId: "s2", sellerName: "Без реквизитов", amountKopecks: 1000, createdAt: new Date("2026-10-14T10:00:00Z"), details: null },
];

describe("реестр выплат", () => {
  it("CSV: сумма с запятой, строка без реквизитов помечена", () => {
    const csv = registryCsv(rows);
    expect(csv.includes("1234,56")).toBe(true);
    expect(csv.includes("НЕТ РЕКВИЗИТОВ: Без реквизитов")).toBe(true);
  });

  it("1С: одно платёжное поручение, без строк без реквизитов", () => {
    const payer = { name: "ООО Светлана", inn: "7707083893", account: "40702810238000000002", bankName: "ПАО Сбербанк", bik: "044525225", corrAccount: "30101810400000000225" };
    const text = registry1C(rows, payer, new Date(2026, 9, 14, 12, 0, 0));
    expect(text.startsWith("1CClientBankExchange\r\n")).toBe(true);
    expect(text.split("СекцияДокумент=").length - 1).toBe(1);
    expect(text.includes("Сумма=1234.56")).toBe(true);
    expect(text.includes("ПолучательСчет=40817810438000000001")).toBe(true);
    expect(text.includes("Дата=14.10.2026")).toBe(true);
    expect(text.trimEnd().endsWith("КонецФайла")).toBe(true);
  });

  it("кодирует кириллицу в Windows-1251", () => {
    expect(Array.from(encodeCp1251("АяЁё№1"))).toEqual([0xc0, 0xff, 0xa8, 0xb8, 0xb9, 0x31]);
  });
});
