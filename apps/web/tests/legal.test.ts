import { describe, expect, it } from "vitest";
import {
  getLegalEntity,
  isLegalInfoComplete,
  isValidInn,
  isValidOgrn,
  missingLegalFields,
} from "@/lib/legal";

const FULL = {
  COMPANY_LEGAL_NAME: " ООО «Тест» ",
  COMPANY_INN: "7707083893",
  COMPANY_OGRN: "1027700132195",
  COMPANY_ADDRESS: "г. Москва, ул. Примерная, д. 1",
  SUPPORT_EMAIL: "help@example.ru",
  SUPPORT_PHONE: "+7 900 000-00-00",
};

describe("реквизиты площадки", () => {
  it("проверяет контрольную сумму ИНН юрлица и ИП", () => {
    expect(isValidInn("7707083893")).toBe(true);
    expect(isValidInn("7707083894")).toBe(false);
    expect(isValidInn("500100732259")).toBe(true);
    expect(isValidInn("500100732258")).toBe(false);
    expect(isValidInn("12345")).toBe(false);
    expect(isValidInn("77070838a3")).toBe(false);
  });

  it("проверяет контрольную сумму ОГРН и ОГРНИП", () => {
    expect(isValidOgrn("1027700132195")).toBe(true);
    expect(isValidOgrn("1027700132196")).toBe(false);
    expect(isValidOgrn("304500116000157")).toBe(true);
    expect(isValidOgrn("304500116000158")).toBe(false);
  });

  it("берёт реквизиты только из окружения и обрезает пробелы", () => {
    const entity = getLegalEntity(FULL);
    expect(entity.name).toBe("ООО «Тест»");
    expect(isLegalInfoComplete(entity)).toBe(true);
  });

  it("честно сообщает, чего не хватает", () => {
    expect(missingLegalFields(getLegalEntity({}))).toEqual([
      "name",
      "inn",
      "ogrn",
      "address",
      "email",
      "phone",
    ]);
    const broken = getLegalEntity({ ...FULL, COMPANY_INN: "1234567890", SUPPORT_EMAIL: "нет" });
    expect(missingLegalFields(broken)).toEqual(["inn", "email"]);
    expect(isLegalInfoComplete(broken)).toBe(false);
  });
});
