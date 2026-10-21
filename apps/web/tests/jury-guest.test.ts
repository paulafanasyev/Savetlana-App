import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { createJuryGuest, isJuryGuestEmail, juryGuestEnabled } from "../src/lib/domains/jury-guest";

const ORIGINAL = process.env.JURY_DEMO;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JURY_DEMO;
  else process.env.JURY_DEMO = ORIGINAL;
});

describe("Вход гостем для жюри", () => {
  it("создаёт отдельного покупателя с согласиями и сессией", async () => {
    delete process.env.JURY_DEMO;
    const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const a = await createJuryGuest(ip);
    const b = await createJuryGuest(ip);
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.user.role).toBe("BUYER");
    expect(isJuryGuestEmail(a.user.email)).toBe(true);
    expect(await prisma.consent.count({ where: { userId: a.user.id, granted: true } })).toBe(2);
    expect(await prisma.session.count({ where: { userId: a.user.id, token: a.token } })).toBe(1);
    expect(await prisma.sellerProfile.count({ where: { userId: a.user.id } })).toBe(0);
  });

  it("не больше 5 гостей в час с одного адреса", async () => {
    delete process.env.JURY_DEMO;
    const ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 5; i += 1) await createJuryGuest(ip);
    await expect(createJuryGuest(ip)).rejects.toThrow();
  });

  it("выключается JURY_DEMO=0", async () => {
    process.env.JURY_DEMO = "0";
    expect(juryGuestEnabled()).toBe(false);
    await expect(createJuryGuest("10.7.0.1")).rejects.toThrow();
  });
});
