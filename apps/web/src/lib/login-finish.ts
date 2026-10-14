/**
 * Завершение входа: сессия, cookie, журнал. Общая часть для входа по паролю
 * и для входа после кода с нового устройства.
 */
import { createToken, setSessionCookie } from "./auth";
import { prisma } from "./prisma";
import { env } from "./env";
import { audit } from "./domains/audit";
import { needsTermsConsent } from "./domains/terms-consent";
import { notifyNewDeviceLogin, type LoginInspection } from "./domains/account-security";

export async function finishLogin(
  user: { id: string; name: string | null; email: string; role: string },
  login: LoginInspection | null,
  options: { method: "password" | "code" }
): Promise<Response> {
  const token = await createToken({ sub: user.id, role: user.role });
  await prisma.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 7 * 864e5), userAgent: login?.userAgent ?? null, ipHash: login?.ipHash ?? null },
  });
  await audit({ actorId: user.id, actorRole: user.role.toLowerCase(), action: "auth.login", targetType: "user", targetId: user.id, after: { method: options.method } });
  if (login?.isNew) {
    if (options.method === "code") {
      // Владелец только что ввёл код из письма: второе письмо не нужно, но вход
      // с нового устройства записываем (от него зависит проверка смены реквизитов).
      await audit({ actorId: user.id, actorRole: "user", action: "auth.new_device_login", targetType: "user", targetId: user.id, after: { device: login.device, confirmedByCode: true } });
    } else {
      await notifyNewDeviceLogin(user.id, login).catch(() => undefined);
    }
  }
  // Аккаунты, созданные до записи согласий или согласившиеся на старую версию условий:
  // страница входа попросит принять условия перед тем, как пустить дальше.
  const needsConsent = await needsTermsConsent(user.id);
  const response = Response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, needsConsent });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
}
