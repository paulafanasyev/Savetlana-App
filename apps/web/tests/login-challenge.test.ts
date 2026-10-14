import { describe, expect, it } from "vitest";
import { loginCodeHash, maskEmail, newLoginCode, normalizeCode, verifyLoginChallenge } from "../src/lib/domains/login-challenge";

describe("код для входа с нового устройства", () => {
  it("код из шести цифр", () => {
    for (let i = 0; i < 50; i++) expect(newLoginCode()).toMatch(/^\d{6}$/);
  });

  it("хэш зависит и от вызова, и от кода", () => {
    const a = loginCodeHash("a".repeat(48), "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(loginCodeHash("a".repeat(48), "123457")).not.toBe(a);
    expect(loginCodeHash("b".repeat(48), "123456")).not.toBe(a);
  });

  it("почта в подсказке скрыта", () => {
    expect(maskEmail("paul@mail.ru")).toBe("p***@mail.ru");
    expect(maskEmail("bad")).toBe("почту");
  });

  it("код очищается от пробелов и лишнего", () => {
    expect(normalizeCode(" 12 34 56 ")).toBe("123456");
    expect(normalizeCode("1234567")).toBe("123456");
  });

  it("кривой вызов или код отклоняются без похода в базу", async () => {
    expect(await verifyLoginChallenge("short", "123456")).toBeNull();
    expect(await verifyLoginChallenge("a".repeat(48), "12ab56")).toBeNull();
  });
});
