import { prisma } from "../prisma";
import { env } from "../env";
import { audit } from "./audit";
import { mayPromoteToAdmin } from "../admin-promotion";

/**
 * Делает пользователя администратором только по явному списку ADMIN_EMAILS и только
 * после подтверждения почты (см. lib/admin-promotion.ts). Вызывается при регистрации,
 * входе и сразу после подтверждения почты.
 */
export async function promoteConfiguredAdmin(userId: string, email: string) {
  if (!env.adminEmails.includes(email.trim().toLowerCase())) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, emailVerifiedAt: true } });
  if (!user || !mayPromoteToAdmin(user, env.adminEmails)) return false;
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
  await audit({ actorId: user.id, actorRole: "admin", action: "auth.admin_bootstrap", targetType: "User", targetId: user.id, before: { role: user.role }, after: { role: "ADMIN", reason: "ADMIN_EMAILS+verified_email" } });
  return true;
}
