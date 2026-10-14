import { describe, expect, it } from "vitest";
import { recoveryTokenMatches } from "../src/lib/domains/admin-recovery";

describe("аварийное восстановление администратора", () => {
  const secret = "s3cr3t-recovery-token-123456789";
  it("принимает только заданный длинный секрет", () => {
    expect(recoveryTokenMatches(secret, secret)).toBe(true);
    expect(recoveryTokenMatches("wrong", secret)).toBe(false);
    expect(recoveryTokenMatches(secret, undefined)).toBe(false);
    expect(recoveryTokenMatches("short", "short")).toBe(false);
  });
});
