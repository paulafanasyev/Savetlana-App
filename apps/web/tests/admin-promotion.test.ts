import { describe, expect, it } from "vitest";
import { mayPromoteToAdmin } from "../src/lib/admin-promotion";
import { recoveryTokenFingerprint } from "../src/lib/domains/admin-recovery";

const LIST = ["owner@example.test"];

describe("админ по ADMIN_EMAILS только с подтверждённой почтой", () => {
  it("неподтверждённая почта из списка админку не даёт", () => {
    expect(mayPromoteToAdmin({ email: "owner@example.test", emailVerifiedAt: null, role: "BUYER" }, LIST)).toBe(false);
  });
  it("подтверждённая почта из списка даёт", () => {
    expect(mayPromoteToAdmin({ email: " Owner@Example.test ", emailVerifiedAt: new Date(), role: "SELLER" }, LIST)).toBe(true);
  });
  it("почта не из списка не даёт, даже подтверждённая", () => {
    expect(mayPromoteToAdmin({ email: "other@example.test", emailVerifiedAt: new Date(), role: "BUYER" }, LIST)).toBe(false);
  });
  it("уже админа повторно не повышаем", () => {
    expect(mayPromoteToAdmin({ email: "owner@example.test", emailVerifiedAt: new Date(), role: "ADMIN" }, LIST)).toBe(false);
  });
});

describe("отпечаток секрета восстановления", () => {
  it("одинаковый для одного секрета, разный для разных, и не содержит сам секрет", () => {
    const a = "s3cr3t-recovery-token-123456789";
    expect(recoveryTokenFingerprint(a)).toBe(recoveryTokenFingerprint(a));
    expect(recoveryTokenFingerprint(a)).not.toBe(recoveryTokenFingerprint(`${a}x`));
    expect(recoveryTokenFingerprint(a)).not.toContain(a);
  });
});
