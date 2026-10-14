/**
 * Уведомления продавцу в Telegram.
 *
 * Как подключается:
 *  1. Продавец в кабинете нажимает «Подключить Telegram» и получает ссылку
 *     t.me/<бот>?start=<одноразовый код>. Код живёт 15 минут, в базе хранится
 *     только его SHA-256 (как у ссылок сброса пароля).
 *  2. В Telegram он нажимает «Запустить». Бот получает /start <код>, по коду
 *     находит аккаунт и запоминает номер чата (IntegrationLink, провайдер TELEGRAM).
 *  3. Дальше каждое уведомление кабинета (новый оплаченный заказ, сообщение
 *     покупателя, заканчивается товар, выплата) дублируется в этот чат.
 *
 * Письма безопасности (сброс пароля, подтверждение почты) в Telegram не идут:
 * если кто-то на минуту получил доступ к кабинету и привязал свой Telegram,
 * он не должен получать ссылки на смену пароля.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Notification } from "@prisma/client";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { hasChannelConsent } from "../notification-delivery";
import { formatTelegramMessage, isChatGone, telegramApi, telegramConfig } from "../telegram";

export const TELEGRAM_PROVIDER = "TELEGRAM";
const LINK_PURPOSE = "TELEGRAM_LINK";
const LINK_TTL_MINUTES = 15;
/** Виды уведомлений, которые в Telegram не дублируются. */
const NOT_FOR_TELEGRAM = new Set(["security"]);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface TelegramLinkCode {
  /** Ссылка на бота; null, если бот не настроен. */
  url: string | null;
  code: string;
  expiresAt: Date;
}

/** Новый одноразовый код привязки. Предыдущий неиспользованный код гасится. */
export async function createTelegramLinkCode(userId: string): Promise<TelegramLinkCode> {
  // 24 байта в hex = 48 символов: Telegram принимает в start до 64 символов [A-Za-z0-9_-].
  const code = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.authTicket.updateMany({ where: { userId, purpose: LINK_PURPOSE, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.authTicket.create({ data: { userId, purpose: LINK_PURPOSE, tokenHash: sha256Hex(code), expiresAt } });
  }, { maxWait: 15000, timeout: 15000 });
  const config = telegramConfig();
  return { url: config ? `https://t.me/${config.username}?start=${code}` : null, code, expiresAt };
}

export type LinkOutcome = { ok: true; userId: string } | { ok: false; reason: "invalid" | "used" | "expired" };

/** Привязать чат по коду из /start. Код срабатывает один раз. */
export async function completeTelegramLink(code: string, chatId: string): Promise<LinkOutcome> {
  if (!/^[a-f0-9]{48}$/.test(code)) return { ok: false, reason: "invalid" };
  const ticket = await prisma.authTicket.findUnique({
    where: { tokenHash: sha256Hex(code) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });
  if (!ticket || ticket.purpose !== LINK_PURPOSE) return { ok: false, reason: "invalid" };
  if (ticket.consumedAt) return { ok: false, reason: "used" };
  if (ticket.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  // Гасим код атомарно: два одновременных /start с одним кодом не пройдут оба.
  const spent = await prisma.authTicket.updateMany({ where: { id: ticket.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (spent.count === 0) return { ok: false, reason: "used" };

  const seller = await prisma.sellerProfile.findUnique({ where: { userId: ticket.userId }, select: { id: true } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Один Telegram на аккаунт: старые привязки этого пользователя снимаем.
    await tx.integrationLink.updateMany({
      where: { userId: ticket.userId, provider: TELEGRAM_PROVIDER, unlinkedAt: null, NOT: { externalId: chatId } },
      data: { status: "REVOKED", unlinkedAt: now },
    });
    // Один чат на аккаунт: если этот чат был привязан к другому аккаунту, он переходит сюда.
    await tx.integrationLink.upsert({
      where: { provider_externalId: { provider: TELEGRAM_PROVIDER, externalId: chatId } },
      create: { userId: ticket.userId, sellerId: seller?.id ?? null, provider: TELEGRAM_PROVIDER, externalId: chatId, externalScope: '["notifications"]', status: "ACTIVE", linkedAt: now },
      update: { userId: ticket.userId, sellerId: seller?.id ?? null, status: "ACTIVE", externalScope: '["notifications"]', linkedAt: now, unlinkedAt: null },
    });
  }, { maxWait: 15000, timeout: 15000 });
  await audit({ actorId: ticket.userId, actorRole: "user", action: "telegram.linked", targetType: "user", targetId: ticket.userId });
  // Письмо владельцу: если Telegram подключил не он, он сразу узнает и отключит.
  const { notify } = await import("./notifications");
  await notify({
    userId: ticket.userId,
    kind: "security",
    title: "К магазину подключён Telegram",
    body: "Уведомления кабинета теперь приходят и в Telegram. Если это были не вы, отключите Telegram в кабинете продавца и смените пароль.",
    url: "/seller",
  }).catch(() => undefined);
  return { ok: true, userId: ticket.userId };
}

export async function unlinkTelegramForUser(userId: string): Promise<number> {
  const res = await prisma.integrationLink.updateMany({
    where: { userId, provider: TELEGRAM_PROVIDER, unlinkedAt: null },
    data: { status: "REVOKED", unlinkedAt: new Date() },
  });
  if (res.count) await audit({ actorId: userId, actorRole: "user", action: "telegram.unlinked", targetType: "user", targetId: userId });
  return res.count;
}

export async function unlinkTelegramChat(chatId: string): Promise<number> {
  const res = await prisma.integrationLink.updateMany({
    where: { provider: TELEGRAM_PROVIDER, externalId: chatId, unlinkedAt: null },
    data: { status: "REVOKED", unlinkedAt: new Date() },
  });
  return res.count;
}

export async function activeTelegramChat(userId: string): Promise<string | null> {
  const link = await prisma.integrationLink.findFirst({
    where: { userId, provider: TELEGRAM_PROVIDER, unlinkedAt: null, status: "ACTIVE" },
    orderBy: { linkedAt: "desc" },
    select: { externalId: true },
  });
  return link?.externalId ?? null;
}

export interface TelegramStatus {
  /** Бот настроен на площадке. */
  configured: boolean;
  linked: boolean;
  botUsername: string | null;
}

export async function telegramStatus(userId: string): Promise<TelegramStatus> {
  const config = telegramConfig();
  const chat = await activeTelegramChat(userId);
  return { configured: Boolean(config), linked: Boolean(chat), botUsername: config?.username ?? null };
}

function redactChat(chatId: string): string {
  return `tg:***${chatId.slice(-3)}`;
}

/**
 * Дублирует уведомление в Telegram, если чат привязан. Каждая попытка
 * записывается в NotificationDelivery с честным статусом, как письма и push.
 */
export async function deliverTelegram(notification: Notification): Promise<void> {
  if (NOT_FOR_TELEGRAM.has(notification.kind)) return;
  const chatId = await activeTelegramChat(notification.userId);
  if (!chatId) return;
  const delivery = await prisma.notificationDelivery.create({
    data: { notificationId: notification.id, userId: notification.userId, channel: "telegram", address: redactChat(chatId), status: "PENDING" },
  });
  const finish = (data: { status: string; error?: string | null; sent?: boolean }) =>
    prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: data.status,
        error: data.error ?? null,
        attempts: data.status === "SUPPRESSED" ? undefined : { increment: 1 },
        lastAttemptAt: data.status === "SUPPRESSED" ? undefined : new Date(),
        sentAt: data.sent ? new Date() : null,
      },
    });
  if (!telegramConfig()) {
    await finish({ status: "SUPPRESSED", error: "TELEGRAM_BOT_TOKEN не настроен — Telegram-уведомления отключены" });
    return;
  }
  if (!(await hasChannelConsent(notification.userId, "email", notification.kind))) {
    await finish({ status: "SUPPRESSED", error: "marketing-consent-not-granted" });
    return;
  }
  const message = formatTelegramMessage({ title: notification.title, body: notification.body, url: notification.url });
  const res = await telegramApi("sendMessage", { chat_id: chatId, ...message, disable_web_page_preview: true });
  if (res.ok) {
    await finish({ status: "SENT", sent: true });
    return;
  }
  await finish({ status: "FAILED", error: `telegram: ${res.description}` });
  if (isChatGone(res)) await unlinkTelegramChat(chatId);
}

// ---------------------------------------------------------------------------
// Входящие сообщения боту
// ---------------------------------------------------------------------------

export interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string; type?: string };
  };
}

export type Reply = (chatId: string, text: string) => Promise<unknown>;

const defaultReply: Reply = (chatId, text) => telegramApi("sendMessage", { chat_id: chatId, text });

const HELP =
  "Это бот уведомлений для продавцов. Чтобы подключить магазин, откройте кабинет продавца на сайте и нажмите «Подключить Telegram». Отключить уведомления: /stop";

/** Разбор одного обновления от Telegram. Ответ всегда по-русски и без технических подробностей. */
export async function handleTelegramUpdate(update: TelegramUpdate, reply: Reply = defaultReply): Promise<void> {
  const message = update.message;
  // Уведомления магазина приходят только в личный чат, не в группы.
  if (!message || !message.chat || message.chat.type !== "private") return;
  const rawChatId = message.chat.id;
  if (rawChatId === undefined || rawChatId === null) return;
  const chatId = String(rawChatId);
  const text = (message.text ?? "").trim();

  if (text.startsWith("/start")) {
    const code = text.slice("/start".length).trim();
    if (!code) {
      await reply(chatId, HELP);
      return;
    }
    const outcome = await completeTelegramLink(code, chatId);
    if (outcome.ok) {
      await reply(chatId, "Готово, магазин подключён. Сюда будут приходить новые заказы, сообщения покупателей и напоминания об остатках. Отключить: /stop");
      return;
    }
    const why =
      outcome.reason === "expired"
        ? "Ссылка устарела (она действует 15 минут)."
        : outcome.reason === "used"
        ? "Эта ссылка уже использована."
        : "Ссылка не подошла.";
    await reply(chatId, `${why} Откройте кабинет продавца и нажмите «Подключить Telegram» ещё раз.`);
    return;
  }

  if (text === "/stop") {
    const removed = await unlinkTelegramChat(chatId);
    await reply(chatId, removed ? "Уведомления отключены. Подключить снова можно в кабинете продавца." : "Этот чат не был подключён к магазину.");
    return;
  }

  await reply(chatId, HELP);
}

let webhookReadyFor: string | null = null;

/**
 * Ставит вебхук бота на наш адрес (один раз на запуск сервера). Вызывается при
 * подключении, поэтому отдельная настройка бота администратору не нужна:
 * достаточно трёх переменных окружения. setWebhook повторять безопасно, а
 * повтор после перезапуска подхватывает и новый секрет, если его сменили.
 */
export async function ensureTelegramWebhook(publicAppUrl: string): Promise<{ ok: boolean; error?: string }> {
  const config = telegramConfig();
  if (!config) return { ok: false, error: "not-configured" };
  const url = `${publicAppUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  if (!url.startsWith("https://")) return { ok: false, error: "Telegram принимает только https-адрес сайта" };
  const key = `${url}|${config.webhookSecret}`;
  if (webhookReadyFor === key) return { ok: true };
  const set = await telegramApi("setWebhook", { url, secret_token: config.webhookSecret, allowed_updates: ["message"], drop_pending_updates: false }, config);
  if (!set.ok) return { ok: false, error: set.description };
  await telegramApi("setMyCommands", { commands: [{ command: "stop", description: "Отключить уведомления" }] }, config);
  webhookReadyFor = key;
  return { ok: true };
}

/** Пробное сообщение из кабинета: продавец сразу видит, что всё работает. */
export async function sendTelegramTest(userId: string): Promise<{ ok: boolean; error?: string }> {
  const chatId = await activeTelegramChat(userId);
  if (!chatId) return { ok: false, error: "Telegram не подключён" };
  const res = await telegramApi("sendMessage", { chat_id: chatId, text: "Проверка связи: уведомления магазина приходят сюда." });
  if (res.ok) return { ok: true };
  if (isChatGone(res)) {
    await unlinkTelegramChat(chatId);
    return { ok: false, error: "Бот заблокирован в Telegram. Подключите его заново." };
  }
  return { ok: false, error: "Telegram не ответил. Попробуйте через минуту." };
}
