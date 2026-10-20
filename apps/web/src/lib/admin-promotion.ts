/**
 * Когда почта из ADMIN_EMAILS даёт права администратора. Чистое правило без базы.
 *
 * Только если почта в списке И подтверждена письмом. Иначе достаточно зарегистрироваться
 * с чужой почтой из списка раньше владельца (или с опечаткой из списка), и чужой
 * человек сразу получил бы админку. Если письма не доходят, владелец сайта
 * входит через аварийное восстановление (ADMIN_RECOVERY_TOKEN).
 */
export function mayPromoteToAdmin(
  user: { email: string; emailVerifiedAt: Date | null; role: string },
  adminEmails: readonly string[],
): boolean {
  if (user.role === "ADMIN") return false;
  if (!user.emailVerifiedAt) return false;
  return adminEmails.includes(user.email.trim().toLowerCase());
}
