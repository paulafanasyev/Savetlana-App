/**
 * Второй фактор для администратора: код в Telegram при каждом входе.
 *
 * Включается сам, когда администратор привязал Telegram в профиле (а бот настроен):
 *  - пароль верный -> сессию не создаём, шлём шестизначный код в его чат с ботом;
 *  - код проверяется тем же шагом, что и код с нового устройства (/api/auth/login/verify):
 *    одноразовый, 10 минут, в базе только SHA-256, попытки ограничены;
 *  - код не пишется ни в уведомления сайта, ни в журнал, только в Telegram.
 *
 * Если Telegram привязан, но код не ушёл, вход НЕ пропускается по паролю: иначе второй
 * фактор обходился бы сбоем связи. Если доступ к Telegram потерян, аварийное
 * восстановление (ADMIN_RECOVERY_TOKEN) меняет пароль и отвязывает Telegram.
 *
 * Бот на площадке не настроен или Telegram не привязан: работает обычная защита (код
 * при входе с нового устройства).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { audit } from "./audit";
import { telegramApi, telegramConfig } from "../telegram";
import { activeTelegramChat } from "./telegram-link";
import { LOGIN_CODE_PURPOSE, LOGIN_CODE_TTL_MINUTES, loginCodeHash, newLoginCode, type StartedChallenge } from "./login-challenge";

export type AdminSecondFactor =
  | { kind: "none" }
  | { kind: "sent"; challenge: StartedChallenge }
  | { kind: "failed" };

export interface AdminSecondFactorDeps {
  /** Бот настроен (по умолчанию из окружения). */
  configured?: boolean;
  /** Отправка сообщения; true, если Telegram его принял. */
  send?: (chatId: string, text: string) => Promise<boolean>;
}

const defaultSend = async (chatId: string, text: string): Promise<boolean> =>
  (await telegramApi("sendMessage", { chat_id: chatId, text })).ok;

export async function adminTelegramSecondFactor(
  user: { id: string; role: string },
  login: { device: string } | null,
  deps: AdminSecondFactorDeps = {},
): Promise<AdminSecondFactor> {
  if (user.role !== "ADMIN") return { kind: "none" };
  const configured = deps.configured ?? Boolean(telegramConfig());
  if (!configured) return { kind: "none" };
  const chatId = await activeTelegramChat(user.id);
  if (!chatId) return { kind: "none" };

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

  const device = login?.device ? ` Устройство: «${login.device}».` : "";
  const text = `Код для входа в админку АИКО: ${code}\n\nДействует ${LOGIN_CODE_TTL_MINUTES} минут.${device} Никому не сообщайте код. Если вы не входили, кто-то знает ваш пароль: сразу смените его.`;
  const send = deps.send ?? defaultSend;
  const ok = await send(chatId, text).catch(() => false);
  if (!ok) {
    // Код никуда не дошёл: гасим его, чтобы не оставлять действующий вызов.
    await prisma.authTicket.updateMany({ where: { userId: user.id, purpose: LOGIN_CODE_PURPOSE, consumedAt: null }, data: { consumedAt: new Date() } });
    await audit({ actorId: user.id, actorRole: "admin", action: "auth.admin_2fa_send_failed", targetType: "user", targetId: user.id }).catch(() => undefined);
    return { kind: "failed" };
  }
  await audit({ actorId: user.id, actorRole: "admin", action: "auth.admin_2fa_sent", targetType: "user", targetId: user.id, after: { channel: "telegram" } }).catch(() => undefined);
  return { kind: "sent", challenge: { challenge, sentTo: "в Telegram" } };
}
