import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { adminTelegramSecondFactor } from "../src/lib/domains/admin-2fa";
import { LOGIN_CODE_PURPOSE, verifyLoginChallenge } from "../src/lib/domains/login-challenge";

async function makeUser(role: string, withChat: boolean) {
  const tag = `a2fa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({ data: { email: `${tag}@test.ru`, passwordHash: "x", role } });
  if (withChat) {
    await prisma.integrationLink.create({
      data: { userId: user.id, provider: "TELEGRAM", externalId: `${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: "ACTIVE" },
    });
  }
  return user;
}

describe("Второй фактор администратора через Telegram", () => {
  it("админ с Telegram получает код, код срабатывает один раз", async () => {
    const admin = await makeUser("ADMIN", true);
    const sent: string[] = [];
    const res = await adminTelegramSecondFactor(admin, { device: "Chrome, Windows" }, {
      configured: true,
      send: async (_chat, text) => {
        sent.push(text);
        return true;
      },
    });
    expect(res.kind).toBe("sent");
    if (res.kind !== "sent") return;
    expect(res.challenge.sentTo).toBe("в Telegram");
    const code = /(\d{6})/.exec(sent[0] ?? "")?.[1] ?? "";
    expect(code).toHaveLength(6);
    expect(await verifyLoginChallenge(res.challenge.challenge, code)).toBe(admin.id);
    expect(await verifyLoginChallenge(res.challenge.challenge, code)).toBe(null);
  });

  it("код не ушёл: вход не пропускается, действующего кода не остаётся", async () => {
    const admin = await makeUser("ADMIN", true);
    const res = await adminTelegramSecondFactor(admin, null, { configured: true, send: async () => false });
    expect(res.kind).toBe("failed");
    const live = await prisma.authTicket.count({ where: { userId: admin.id, purpose: LOGIN_CODE_PURPOSE, consumedAt: null } });
    expect(live).toBe(0);
  });

  it("не админ, админ без Telegram и ненастроенный бот: обычный вход", async () => {
    let calls = 0;
    const send = async () => {
      calls += 1;
      return true;
    };
    const buyer = await makeUser("BUYER", true);
    expect((await adminTelegramSecondFactor(buyer, null, { configured: true, send })).kind).toBe("none");
    const lonely = await makeUser("ADMIN", false);
    expect((await adminTelegramSecondFactor(lonely, null, { configured: true, send })).kind).toBe("none");
    const admin = await makeUser("ADMIN", true);
    expect((await adminTelegramSecondFactor(admin, null, { configured: false, send })).kind).toBe("none");
    expect(calls).toBe(0);
  });
});
