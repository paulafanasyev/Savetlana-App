import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { hashPassword, verifyPassword, createToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { audit } from "@/lib/domains/audit";
import { promoteConfiguredAdmin } from "@/lib/domains/admin-bootstrap";
import { needsTermsConsent } from "@/lib/domains/terms-consent";
import { consumeRateLimit, clientIp, loginBuckets, recordAuthOutcome, AUTH_LIMITS, tooMany } from "@/lib/domains/rate-limits";
import { inspectLogin, notifyNewDeviceLogin } from "@/lib/domains/account-security";

export const dynamic = "force-dynamic";

/**
 * Хеш для сравнения, когда аккаунта нет: ответ занимает столько же времени, и по
 * скорости нельзя узнать, зарегистрирована ли почта.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("svetlana-dummy-password-for-timing");
  return dummyHash;
}

export const POST = apiRoute(async (request) => {
  const body = await jsonBody<{ email?: string; password?: string }>(request);
  const email = (body.email ?? "").trim().toLowerCase();
  const ip = clientIp(request);
  for (const bucket of loginBuckets(ip, email)) { const decision = await consumeRateLimit(bucket, AUTH_LIMITS.login.limit, AUTH_LIMITS.login.windowMs); if (!decision.allowed) return tooMany(decision); }
  const found = await prisma.user.findUnique({ where: { email } });
  const invalid = Response.json({ error: "Неверный email или пароль", code: "invalid_credentials" }, { status: 401 });
  if (!found) { await verifyPassword(body.password ?? "", await getDummyHash()); await recordAuthOutcome(`login:ip:${ip}`, false); return invalid; }
  if (!await verifyPassword(body.password ?? "", found.passwordHash)) { await recordAuthOutcome(`login:account:${email}`, false); await recordAuthOutcome(`login:ip:${ip}`, false); return invalid; }
  // О блокировке говорим только тому, кто знает пароль, иначе любой мог бы проверить чужую почту.
  if (found.isBlocked) return Response.json({ error: "Аккаунт заблокирован", code: "blocked" }, { status: 403 });
  await recordAuthOutcome(`login:account:${email}`, true); await recordAuthOutcome(`login:ip:${ip}`, true);
  await promoteConfiguredAdmin(found.id, email);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: found.id } });
  const token = await createToken({ sub: user.id, role: user.role });
  // Устройство сравниваем с прошлыми входами до записи новой сессии.
  const login = await inspectLogin(user.id, request.headers.get("user-agent"), ip).catch(() => null);
  await prisma.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 7 * 864e5), userAgent: login?.userAgent ?? null, ipHash: login?.ipHash ?? null },
  });
  await audit({ actorId: user.id, actorRole: user.role.toLowerCase(), action: "auth.login", targetType: "user", targetId: user.id });
  // Вход с нового устройства: владелец сразу получает письмо и может сменить пароль.
  if (login?.isNew) await notifyNewDeviceLogin(user.id, login).catch(() => undefined);
  // Аккаунты, созданные до записи согласий или согласившиеся на старую версию условий:
  // страница входа попросит принять условия перед тем, как пустить дальше.
  const needsConsent = await needsTermsConsent(user.id);
  const response = Response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, needsConsent });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
});
