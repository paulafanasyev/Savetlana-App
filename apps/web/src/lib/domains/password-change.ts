/**
 * Смена пароля из профиля, когда человек помнит текущий пароль.
 *
 * Обязательно спрашиваем текущий пароль: иначе тот, кто сел за чужой открытый
 * ноутбук, отобрал бы аккаунт за минуту. После смены завершаем все остальные
 * входы (текущий оставляем, чтобы человека не выкидывало) и шлём письмо
 * «Пароль изменён», чтобы владелец узнал, если менял не он.
 */
import { prisma } from "../prisma";
import { ApiError, hashPassword, verifyPassword } from "../auth";
import { audit } from "./audit";
import { notifyPasswordChanged } from "./password-changed";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/** Проверка нового пароля без базы: длина и отличие от текущего. */
export function newPasswordProblem(current: string, next: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) return `Новый пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`;
  if (next.length > MAX_PASSWORD_LENGTH) return `Новый пароль слишком длинный, максимум ${MAX_PASSWORD_LENGTH} символов.`;
  if (next === current) return "Новый пароль совпадает с текущим.";
  if (!next.trim()) return "Пароль не может состоять из одних пробелов.";
  return null;
}

/** Меняет пароль. Возвращает, сколько других входов завершено. */
export async function changePassword(userId: string, keepSessionId: string | null, current: string, next: string): Promise<{ otherSessionsEnded: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } });
  if (!user) throw new ApiError(404, "Пользователь не найден.");
  if (!current) throw new ApiError(400, "Введите текущий пароль.");
  const ok = user.passwordHash ? await verifyPassword(current, user.passwordHash) : false;
  if (!ok) throw new ApiError(400, "Текущий пароль указан неверно.");
  const problem = newPasswordProblem(current, next);
  if (problem) throw new ApiError(400, problem);

  const passwordHash = await hashPassword(next);
  const [, ended] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
      data: { revokedAt: new Date() },
    }),
  ]);

  await audit({
    action: "password_changed",
    actorId: userId,
    actorRole: "user",
    targetType: "user",
    targetId: userId,
    after: { otherSessionsEnded: ended.count },
  });
  await notifyPasswordChanged(userId, "change");
  return { otherSessionsEnded: ended.count };
}
