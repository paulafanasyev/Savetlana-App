import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { createTelegramLinkCode, handleTelegramUpdate, telegramStatus } from "../src/lib/domains/telegram-link";

describe("Telegram для пользователя без магазина", () => {
  it("автор объявлений подключает Telegram, бот не говорит ему про магазин", async () => {
    const tag = `tgu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await prisma.user.create({ data: { email: `${tag}@test.ru`, passwordHash: "x" } });
    const chatId = String(Math.floor(Math.random() * 1e9));
    const replies: string[] = [];
    const { code } = await createTelegramLinkCode(user.id);
    await handleTelegramUpdate({ message: { text: `/start ${code}`, chat: { id: Number(chatId), type: "private" } } }, async (_c, t) => {
      replies.push(t);
    });
    const last = replies[replies.length - 1] ?? "";
    expect(last.includes("Готово")).toBe(true);
    expect(last.includes("магазин")).toBe(false);
    expect((await telegramStatus(user.id)).linked).toBe(true);
    const link = await prisma.integrationLink.findFirst({ where: { userId: user.id, provider: "TELEGRAM" } });
    expect(link?.sellerId ?? null).toBe(null);
  });
});
