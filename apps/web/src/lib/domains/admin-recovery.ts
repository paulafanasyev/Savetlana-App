/**
 * Аварийное восстановление доступа администратора, когда письмо со сбросом
 * пароля не приходит (например, почта для писем ещё не настроена).
 *
 * Работает только если владелец сайта сам задал в настройках сервера секрет
 * ADMIN_RECOVERY_TOKEN (не короче 24 символов), и только для почт из
 * ADMIN_EMAILS. Без секрета восстановление выключено. После входа секрет
 * нужно удалить из настроек: он одноразовый по смыслу, хотя технически
 * действует, пока задан.
 *
 * Попытки ограничены (5 в час с одного адреса, 20 в час всего), каждая
 * записывается в журнал. Старые входы на всех устройствах завершаются.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";
import { ApiError, hashPassword } from "../auth";
import { audit } from "./audit";
import { consumeRateLimit } from "./rate-limits";
import { notifyPasswordChanged } from "./password-changed";

export const MIN_RECOVERY_TOKEN_LENGTH = 24;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Сравнение секрета за постоянное время, чтобы его нельзя было подобрать по времени ответа. */
export function recoveryTokenMatches(presented: string, configured: string | undefined): boolean {
  if (!configured || configured.length < MIN_RECOVERY_TOKEN_LENGTH) return false;
  return timingSafeEqual(digest(presented), digest(configured));
}

export function adminRecoveryEnabled(): boolean {
  const token = process.env.ADMIN_RECOVERY_TOKEN;
  return Boolean(token && token.length >= MIN_RECOVERY_TOKEN_LENGTH && env.adminEmails.length > 0);
}

export async function recoverAdminPassword(input: { email: string; token: string; newPassword: string; ip: string }): Promise<{ email: string }> {
  if (!adminRecoveryEnabled()) {
    throw new ApiError(404, "Аварийное восстановление выключено. Задайте ADMIN_RECOVERY_TOKEN в настройках сервера.", "recovery_disabled");
  }
  const [perIp, global] = await Promise.all([
    consumeRateLimit(`admin-recovery:ip:${input.ip}`, 5, 60 * 60_000),
    consumeRateLimit("admin-recovery:global", 20, 60 * 60_000),
  ]);
  if (!perIp.allowed || !global.allowed) throw new ApiError(429, "Слишком много попыток. Попробуйте через час.", "rate_limited");

  const email = input.email.trim().toLowerCase();
  const tokenOk = recoveryTokenMatches(input.token.trim(), process.env.ADMIN_RECOVERY_TOKEN);
  const allowedEmail = env.adminEmails.includes(email);
  if (!tokenOk || !allowedEmail) {
    await audit({ actorRole: "anonymous", action: "auth.admin_recovery_failed", targetType: "User", after: { email, tokenOk, allowedEmail } });
    // Одинаковый ответ, чтобы не подсказывать, что именно неверно.
    throw new ApiError(403, "Неверная почта или секрет восстановления.", "recovery_denied");
  }
  if (input.newPassword.length < 8) throw new ApiError(400, "Пароль должен быть не короче 8 символов.", "weak_password");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new ApiError(404, "Аккаунта с этой почтой нет. Зарегистрируйтесь: почта из ADMIN_EMAILS сразу получит права администратора.", "no_account");

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, role: "ADMIN", isBlocked: false } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ actorId: user.id, actorRole: "admin", action: "auth.admin_recovery", targetType: "User", targetId: user.id, after: { email } });
  await notifyPasswordChanged(user.id, "admin_recovery");
  return { email };
}
