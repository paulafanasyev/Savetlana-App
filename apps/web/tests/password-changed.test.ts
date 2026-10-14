import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { requestPasswordReset, resetPassword } from "../src/lib/domains/account-recovery";
import { moscowTime, passwordChangedMessage, PASSWORD_CHANGED_TITLE } from "../src/lib/domains/password-changed";

const USER = "pwd-changed-user";
const EMAIL = "pwd-changed@svetlana.example";

describe("письмо о смене пароля", () => {
  it("время пишется по Москве", () => {
    expect(moscowTime(new Date("2026-10-14T15:42:00Z"))).toBe("14.10.2026, 18:42");
  });

  it("после сброса говорит про выход на других устройствах и задержку выплат", () => {
    const m = passwordChangedMessage("reset", new Date("2026-10-14T15:42:00Z"));
    expect(m.title).toBe(PASSWORD_CHANGED_TITLE);
    expect(m.body).toContain("14.10.2026, 18:42");
    expect(m.body).toContain("Все входы на других устройствах завершены");
    expect(m.body).toContain("придержаны на 24 часа");
    expect(m.body).toContain("Забыли пароль");
  });

  it("при аварийном восстановлении про выплаты не пишет", () => {
    const m = passwordChangedMessage("admin_recovery", new Date("2026-10-14T15:42:00Z"));
    expect(m.body).toContain("аварийное восстановление");
    expect(m.body.includes("придержаны")).toBe(false);
  });

  it("сброс пароля создаёт уведомление без пароля и ссылки", async () => {
    const bcrypt = await import("bcryptjs");
    await prisma.user.upsert({
      where: { id: USER },
      create: { id: USER, email: EMAIL, passwordHash: await bcrypt.hash("password123", 10), name: "Тест", role: "BUYER" },
      update: {},
    });
    const result = await requestPasswordReset(EMAIL);
    const secret = new URL(result.devLink ?? "http://x/?ticket=").searchParams.get("ticket") ?? "";
    await resetPassword(secret, "brandNewPass789");

    const notes = await prisma.notification.findMany({ where: { userId: USER, title: PASSWORD_CHANGED_TITLE } });
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].kind).toBe("security");
    expect(notes[0].body.includes("brandNewPass789")).toBe(false);
    expect(notes[0].body.includes("ticket=")).toBe(false);
  });
});
