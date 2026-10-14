/**
 * Вход с кодом (вторая ступень) для новых устройств.
 *
 * Пароль верный, но устройство незнакомое: сессию не создаём, а отправляем
 * шестизначный код на почту. Без кода по украденному паролю не войти. В Telegram
 * код не идёт: письма безопасности туда не дублируются (см. telegram-link.ts).
 *
 * - В базе хранится только SHA-256 от пары «вызов + код»; из текста уведомления
 *   код вырезается сразу после отправки письма.
 * - Код одноразовый и живёт 10 минут; новый запрос гасит прежний.
 * - Попытки ограничены по вызову и по IP (счётчик в базе, а не в памяти сервера).
 * - Если письмо не ушло (почта на площадке не настроена), владелец не должен
 *   остаться без входа: вход пропускается, а в журнал пишется вход с нового устройства.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "../prisma";
import { notify } from "./notifications";
import type { LoginInspection } from "./account-security";

export const LOGIN_CODE_PURPOSE = "LOGIN_CODE";
export const LOGIN_CODE_TTL_MINUTES = 10;

export function loginCodeHash(challenge: string, code: string): string {
  return createHash("sha256").update(`login-code:${challenge}:${code}`).digest("hex");
}

export function newLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Почта для подсказки: a***@mail.ru. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "почту";
  return `${name.slice(0, 1)}***@${domain}`;
}

export function normalizeCode(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 6);
}

export interface StartedChallenge {
  challenge: string;
  /** Куда отправлен код, по-человечески: «на почту a***@mail.ru». */
  sentTo: string;
}

/**
 * Создаёт вызов и отправляет код. Возвращает null, если письмо не ушло:
 * тогда вход продолжается без кода.
 */
export async function startLoginChallenge(user: { id: string; email: string }, login: LoginInspection): Promise<StartedChallenge | null> {
  const challenge = randomBytes(24).toString("hex");
  const code = newLoginCode();
  const startedAt = new Date();
  await prisma.$transaction([
    prisma.authTicket.updateMany({ where: { userId: user.id, purpose: LOGIN_CODE_PURPOSE, consumedAt: null }, data: { consumedAt: startedAt } }),
    prisma.authTicket.create({
      data: {
        userId: user.id,
        purpose: LOGIN_CODE_PURPOSE,
        tokenHash: loginCodeHash(challenge, code),
        expiresAt: new Date(startedAt.getTime() + LOGIN_CODE_TTL_MINUTES * 60_000),
      },
    }),
  ]);
  await notify(
    {
      userId: user.id,
      kind: "security",
      title: "Код для входа",
      body: `Код для входа в АИКО: ${code}. Действует ${LOGIN_CODE_TTL_MINUTES} минут. Вход с нового устройства «${login.device}». Никому не сообщайте код, сотрудники площадки его не спрашивают. Если вы не входили, кто-то знает ваш пароль: смените его через «Забыли пароль».`,
    },
    { awaitDelivery: true }
  );
  // Письмо ушло, а в ленте уведомлений и в базе код не храним: прячем его.
  const issued = await prisma.notification.findMany({
    where: { userId: user.id, title: "Код для входа", createdAt: { gte: startedAt } },
    select: { id: true, body: true },
  });
  for (const n of issued) {
    await prisma.notification.update({ where: { id: n.id }, data: { body: n.body.replace(code, "••••••") } }).catch(() => undefined);
  }
  const sent = await prisma.notificationDelivery.findMany({
    where: { userId: user.id, status: "SENT", createdAt: { gte: startedAt }, notification: { title: "Код для входа" } },
    select: { channel: true },
  });
  const channels = new Set(sent.map((s) => s.channel));
  if (channels.size === 0) {
    // Доставить некуда: гасим вызов, чтобы не оставлять действующий код.
    await prisma.authTicket.updateMany({ where: { userId: user.id, purpose: LOGIN_CODE_PURPOSE, consumedAt: null }, data: { consumedAt: new Date() } });
    return null;
  }
  return { challenge, sentTo: channels.has("email") ? `на почту ${maskEmail(user.email)}` : "в уведомления на ваших устройствах" };
}

/** Проверяет код. Возвращает id пользователя или null; код гасится сразу. */
export async function verifyLoginChallenge(challenge: string, code: string): Promise<string | null> {
  if (!/^[0-9a-f]{48}$/.test(challenge) || !/^\d{6}$/.test(code)) return null;
  const ticket = await prisma.authTicket.findUnique({
    where: { tokenHash: loginCodeHash(challenge, code) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });
  if (!ticket || ticket.purpose !== LOGIN_CODE_PURPOSE || ticket.consumedAt || ticket.expiresAt.getTime() < Date.now()) return null;
  // Гасим атомарно: при двух одновременных запросах войдёт только один.
  const spent = await prisma.authTicket.updateMany({ where: { id: ticket.id, consumedAt: null }, data: { consumedAt: new Date() } });
  return spent.count === 1 ? ticket.userId : null;
}
