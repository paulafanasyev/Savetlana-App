import { prisma } from "../prisma";
import { env } from "../env";
import { audit } from "./audit";

/** Делает пользователя администратором только по явному списку ADMIN_EMAILS. */
export async function promoteConfiguredAdmin(userId: string, email: string) {
  if (!env.adminEmails.includes(email.trim().toLowerCase())) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } });
  if (!user || user.role === "ADMIN") return false;
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
  await audit({ actorId: user.id, actorRole: "admin", action: "auth.admin_bootstrap", targetType: "User", targetId: user.id, before: { role: user.role }, after: { role: "ADMIN", reason: "ADMIN_EMAILS" } });
  return true;
}
