import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { formatTelegramMessage, isChatGone, telegramConfig } from "../src/lib/telegram";
import {
  completeTelegramLink,
  createTelegramLinkCode,
  deliverTelegram,
  handleTelegramUpdate,
  telegramStatus,
  unlinkTelegramForUser,
} from "../src/lib/domains/telegram-link";

const saved = { ...process.env };
afterEach(() => {
  for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function makeSeller(tag: string) {
  const user = await prisma.user.create({ data: { email: `${tag}@test.ru`, passwordHash: "x", role: "SELLER" } });
  await prisma.sellerProfile.create({ data: { userId: user.id, slug: tag, displayName: "Тест Telegram" } });
  return user;
}

function tag() {
  return `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

describe("Telegram: настройки и формат", () => {
  it("без всех трёх переменных бот считается выключенным", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(telegramConfig()).toBeNull();
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_BOT_USERNAME = "@svetlana_shop_bot";
    process.env.TELEGRAM_WEBHOOK_SECRET = "короткий";
    expect(telegramConfig()).toBeNull();
    process.env.TELEGRAM_WEBHOOK_SECRET = "a".repeat(32);
    expect(telegramConfig()).toMatchObject({ username: "svetlana_shop_bot" });
  });

  it("кнопка только для https, иначе ссылка в тексте", () => {
    const https = formatTelegramMessage({ title: "Новый заказ", body: "Оплачен", url: "https://site.ru/seller/orders" });
    expect(https.reply_markup?.inline_keyboard[0][0]).toEqual({ text: "Открыть", url: "https://site.ru/seller/orders" });
    const local = formatTelegramMessage({ title: "Новый заказ", body: "Оплачен", url: "http://localhost:3000/x" });
    expect(local.reply_markup).toBeUndefined();
    expect(local.text).toContain("http://localhost:3000/x");
  });

  it("узнаёт заблокированного бота", () => {
    expect(isChatGone({ ok: false, status: 403, description: "Forbidden: bot was blocked by the user" })).toBe(true);
    expect(isChatGone({ ok: false, status: 400, description: "Bad Request: chat not found" })).toBe(true);
    expect(isChatGone({ ok: false, status: 429, description: "Too Many Requests" })).toBe(false);
  });
});

describe("Telegram: привязка чата", () => {
  it("код срабатывает один раз, /stop отключает", async () => {
    const user = await makeSeller(tag());
    const chatId = String(Math.floor(Math.random() * 1e9));
    const replies: string[] = [];
    const reply = async (_chat: string, text: string) => {
      replies.push(text);
    };

    const { code } = await createTelegramLinkCode(user.id);
    await handleTelegramUpdate({ message: { text: `/start ${code}`, chat: { id: Number(chatId), type: "private" } } }, reply);
    expect(replies[replies.length - 1]).toContain("Готово");
    expect((await telegramStatus(user.id)).linked).toBe(true);
    const link = await prisma.integrationLink.findFirst({ where: { userId: user.id, provider: "TELEGRAM" } });
    expect(link).toMatchObject({ externalId: chatId, status: "ACTIVE", unlinkedAt: null });
    expect(link?.sellerId).toBeTruthy();

    await handleTelegramUpdate({ message: { text: `/start ${code}`, chat: { id: Number(chatId), type: "private" } } }, reply);
    expect(replies[replies.length - 1]).toContain("уже использована");

    await handleTelegramUpdate({ message: { text: "/stop", chat: { id: Number(chatId), type: "private" } } }, reply);
    expect(replies[replies.length - 1]).toContain("отключены");
    expect((await telegramStatus(user.id)).linked).toBe(false);
  });

  it("не принимает чужой код, просроченный код и группы", async () => {
    const user = await makeSeller(tag());
    expect(await completeTelegramLink("f".repeat(48), "1")).toEqual({ ok: false, reason: "invalid" });
    expect(await completeTelegramLink("не код", "1")).toEqual({ ok: false, reason: "invalid" });

    const { code } = await createTelegramLinkCode(user.id);
    await prisma.authTicket.updateMany({ where: { userId: user.id, purpose: "TELEGRAM_LINK", consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await completeTelegramLink(code, "2")).toEqual({ ok: false, reason: "expired" });

    const fresh = await createTelegramLinkCode(user.id);
    const replies: string[] = [];
    await handleTelegramUpdate({ message: { text: `/start ${fresh.code}`, chat: { id: -100, type: "group" } } }, async (_c, t) => {
      replies.push(t);
    });
    expect(replies).toHaveLength(0);
    expect((await telegramStatus(user.id)).linked).toBe(false);
  });

  it("новый код гасит старый, чат переезжает к новому аккаунту", async () => {
    const first = await makeSeller(tag());
    const second = await makeSeller(tag());
    const chatId = String(Math.floor(Math.random() * 1e9));
    const old = await createTelegramLinkCode(first.id);
    const current = await createTelegramLinkCode(first.id);
    expect(await completeTelegramLink(old.code, chatId)).toEqual({ ok: false, reason: "used" });
    expect((await completeTelegramLink(current.code, chatId)).ok).toBe(true);

    const other = await createTelegramLinkCode(second.id);
    expect((await completeTelegramLink(other.code, chatId)).ok).toBe(true);
    expect((await telegramStatus(first.id)).linked).toBe(false);
    expect((await telegramStatus(second.id)).linked).toBe(true);
    expect(await unlinkTelegramForUser(second.id)).toBe(1);
  });
});

describe("Telegram: доставка", () => {
  it("без бота честно пишет «отключено», письма безопасности в Telegram не идут", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const user = await makeSeller(tag());
    const { code } = await createTelegramLinkCode(user.id);
    expect((await completeTelegramLink(code, String(Math.floor(Math.random() * 1e9)))).ok).toBe(true);

    const order = await prisma.notification.create({ data: { userId: user.id, kind: "order_status", title: "Новый оплаченный заказ", body: "Соберите заказ" } });
    await deliverTelegram(order);
    const rows = await prisma.notificationDelivery.findMany({ where: { notificationId: order.id, channel: "telegram" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SUPPRESSED");
    expect(rows[0].address).toMatch(/^tg:\*\*\*/);

    const security = await prisma.notification.create({ data: { userId: user.id, kind: "security", title: "Восстановление пароля", body: "ссылка" } });
    await deliverTelegram(security);
    expect(await prisma.notificationDelivery.count({ where: { notificationId: security.id } })).toBe(0);
  });
});
