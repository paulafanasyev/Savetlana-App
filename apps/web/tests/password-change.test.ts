import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { changePassword, newPasswordProblem } from "../src/lib/domains/password-change";
import { passwordChangedMessage, PASSWORD_CHANGED_TITLE } from "../src/lib/domains/password-changed";

const USER = "pwd-change-user";
const EMAIL = "pwd-change@svetlana.example";

describe("смена пароля из профиля", () => {
  it("проверяет новый пароль", () => {
    expect(newPasswordProblem("oldPassword1", "short")).toMatch(/не короче 8/);
    expect(newPasswordProblem("oldPassword1", "oldPassword1")).toMatch(/совпадает/);
    expect(newPasswordProblem("oldPassword1", "x".repeat(201))).toMatch(/слишком длинный/);
    expect(newPasswordProblem("oldPassword1", "newPassword2")).toBeNull();
  });

  it("письмо говорит, что пароль сменили в профиле, и не обещает задержку выплат", () => {
    const m = passwordChangedMessage("change", new Date("2026-10-14T15:42:00Z"));
    expect(m.body).toContain("в настройках профиля");
    expect(m.body.includes("придержаны")).toBe(false);
  });

  it("без верного текущего пароля не меняет, с верным меняет и шлёт письмо", async () => {
    await prisma.user.upsert({
      where: { id: USER },
      create: { id: USER, email: EMAIL, passwordHash: await bcrypt.hash("oldPassword1", 10), name: "Тест", role: "BUYER" },
      update: { passwordHash: await bcrypt.hash("oldPassword1", 10) },
    });
    await expect(changePassword(USER, null, "wrongPassword", "newPassword2")).rejects.toThrow(/неверно/);
    await changePassword(USER, null, "oldPassword1", "newPassword2");
    const user = await prisma.user.findUnique({ where: { id: USER }, select: { passwordHash: true } });
    expect(await bcrypt.compare("newPassword2", user!.passwordHash)).toBe(true);
    const notes = await prisma.notification.findMany({ where: { userId: USER, title: PASSWORD_CHANGED_TITLE } });
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.some((n) => n.body.includes("newPassword2"))).toBe(false);
  });
});
