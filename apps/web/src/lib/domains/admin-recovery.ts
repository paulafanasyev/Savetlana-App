/**
 * Аварийное восстановление доступа администратора, когда письмо со сбросом
 * пароля не приходит (например, почта для писем ещё не настроена).
 *
 * Работает только если владелец сайта сам задал в настройках сервера секрет
 * ADMIN_RECOVERY_TOKEN (не короче 24 символов), и только для почт из ADMIN_EMAILS. Без секрета
 * восстановление выключено.
 *
 * Секрет одноразовый по-настоящему: после успешного восстановления в журнал
 * пишется его отпечаток (часть sha-256, сам секрет не хранится), и тот же секрет
 * больше не срабатывает, даже если его забыли удалить из настроек. Для следующего
 * восстановления нужен новый секрет. Остальные администраторы получают
 * уведомление, что восстановлением воспользовались.
 *
 * Попытки ограничены (5 в час с одного адреса, 20 в час всего), каждая
 * записывается в журнал. Старые входы на всех устройствах завершаются.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";
import { ApiError, hashPassword } from "../auth";
import { audit } from "./audit";
import { notify } from "./notifications";
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

/** Отпечаток секрета для журнала: по нему нельзя восстановить секрет, но можно узнать повтор. */
export function recoveryTokenFingerprint(token: string): string {
  return `rt_${digest(`admin-recovery:${token}`).toString("hex").slice(0, 24)}`;
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
  const token = input.token.trim();
  const tokenOk = recoveryTokenMatches(token, process.env.ADMIN_RECOVERY_TOKEN);
  const allowedEmail = env.adminEmails.includes(email);
  if (!tokenOk || !allowedEmail) {
    await audit({ actorRole: "anonymous", action: "auth.admin_recovery_failed", targetType: "User", after: { email, tokenOk, allowedEmail } });
    // Одинаковый ответ, чтобы не подсказывать, что именно неверно.
    throw new ApiError(403, "Неверная почта или секрет восстановления.", "recovery_denied");
  }

  // Одноразовость: этот секрет уже сработал раньше?
  const fingerprint = recoveryTokenFingerprint(token);
  const used = await prisma.auditLog.findFirst({
    where: { action: "auth.admin_recovery", after: { contains: fingerprint } },
    select: { id: true },
  });
  if (used) {
    await audit({ actorRole: "anonymous", action: "auth.admin_recovery_reused", targetType: "User", after: { email } });
    throw new ApiError(403, "Этот секрет восстановления уже использован. Задайте в настройках сервера новый ADMIN_RECOVERY_TOKEN.", "recovery_token_used");
  }
  if (input.newPassword.length < 8) throw new ApiError(400, "Пароль должен быть не короче 8 символов.", "weak_password");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new ApiError(404, "Аккаунта с этой почтой нет. Сначала зарегистрируйтесь с этой почтой, потом повторите восстановление.", "no_account");

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, role: "ADMIN", isBlocked: false } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ actorId: user.id, actorRole: "admin", action: "auth.admin_recovery", targetType: "User", targetId: user.id, after: { email, token: fingerprint } });
  await notifyPasswordChanged(user.id, "admin_recovery");

  // Другие администраторы должны узнать, что кто-то вошёл через аварийный секрет.
  const admins = await prisma.user
    .findMany({ where: { role: "ADMIN", id: { not: user.id } }, select: { id: true }, take: 20 })
    .catch(() => [] as { id: string }[]);
  for (const a of admins) {
    await notify({
      userId: a.id,
      kind: "security",
      title: "Использовано аварийное восстановление администратора",
      body: `Доступ администратора для ${email} восстановлен через аварийный секрет. Если это не ваш коллега, срочно смените ADMIN_RECOVERY_TOKEN и проверьте журнал действий.`,
      url: "/admin",
    }).catch(() => undefined);
  }
  return { email };
}
