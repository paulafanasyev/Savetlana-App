import { after } from "next/server";
import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { hashPassword, createToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { audit } from "@/lib/domains/audit";
import { promoteConfiguredAdmin } from "@/lib/domains/admin-bootstrap";
import { requestEmailVerification } from "@/lib/domains/account-recovery";
import { consumeRateLimit, clientIp, AUTH_LIMITS, tooMany } from "@/lib/domains/rate-limits";

export const dynamic = "force-dynamic";

/**
 * Версия условий и политики, на которую даётся согласие (совпадает с CONSENT_VERSION в
 * consents.ts). При изменении текстов /legal/offer или /privacy версию нужно поднять.
 */
const TERMS_VERSION = "1.0";
/** Согласия, без которых аккаунт не работает: обработка персональных данных и необходимые cookie. */
const REGISTRATION_CONSENTS = ["PERSONAL_DATA", "COOKIES_STRICTLY_NECESSARY"] as const;

const EXISTS = () => Response.json({ error: "Пользователь с таким email уже существует", code: "exists" }, { status: 409 });

export const POST = apiRoute(async (request) => {
  const ip = clientIp(request);
  const decision = await consumeRateLimit(`register:ip:${ip}`, AUTH_LIMITS.register.limit, AUTH_LIMITS.register.windowMs);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ name?: string; email?: string; password?: string; role?: string; acceptTerms?: boolean }>(request);
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const name = (body.name ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Некорректный email", code: "bad_email" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Пароль должен быть не короче 8 символов", code: "weak_password" }, { status: 400 });
  if (name.length < 2) return Response.json({ error: "Укажите имя", code: "bad_name" }, { status: 400 });
  // 152-ФЗ: без явного согласия на обработку персональных данных аккаунт не создаём.
  if (body.acceptTerms !== true) return Response.json({ error: "Чтобы создать аккаунт, примите условия и согласие на обработку персональных данных", code: "consent_required" }, { status: 400 });
  const requestedRole = body.role === "SELLER" ? "SELLER" : "BUYER";
  if (await prisma.user.findUnique({ where: { email } })) return EXISTS();
  const passwordHash = await hashPassword(password);
  const consentedAt = new Date();
  // Аккаунт, профиль, согласия и кабинет продавца создаются вместе: если что-то упало
  // посередине, не остаётся «полуаккаунта» и аккаунта без записанного согласия.
  // Две одновременные регистрации с одной почтой дают понятный ответ 409, а не ошибку сервера.
  const created = await prisma
    .$transaction(async (tx) => {
      const u = await tx.user.create({ data: { name, email, passwordHash, role: requestedRole, isBlocked: false } });
      await tx.profile.create({ data: { userId: u.id } });
      for (const type of REGISTRATION_CONSENTS) {
        await tx.consent.create({ data: { userId: u.id, type, granted: true, source: "registration", version: TERMS_VERSION, grantedAt: consentedAt } });
      }
      // Кабинет продавца создаём по выбору человека, а не по итоговой роли: администратор
      // из ADMIN_EMAILS, выбравший «Я продавец», тоже должен получить кабинет.
      if (requestedRole === "SELLER") await tx.sellerProfile.create({ data: { userId: u.id, displayName: name, slug: `seller-${u.id.slice(-8)}` } });
      return u;
    }, { maxWait: 15000, timeout: 15000 })
    .catch((e: unknown) => {
      if ((e as { code?: string } | null)?.code === "P2002") return null;
      throw e;
    });
  if (!created) return EXISTS();
  await promoteConfiguredAdmin(created.id, email);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
  const token = await createToken({ sub: user.id, role: user.role });
  await prisma.session.create({ data: { userId: user.id, token, expiresAt: new Date(Date.now() + 7 * 864e5) } });
  await audit({ actorId: user.id, actorRole: user.role.toLowerCase(), action: "auth.register", targetType: "user", targetId: user.id, after: { role: user.role, seller: requestedRole === "SELLER" } });
  // Доказательство согласия для проверок: кто, когда, на какую версию условий, с какого адреса и браузера.
  await audit({
    actorId: user.id,
    actorRole: user.role.toLowerCase(),
    action: "consent.registration",
    targetType: "user",
    targetId: user.id,
    after: {
      types: [...REGISTRATION_CONSENTS],
      version: TERMS_VERSION,
      documents: ["/legal/offer", "/privacy"],
      at: consentedAt.toISOString(),
      ip,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    },
  });
  let verificationSecret: string | undefined;
  if (env.nodeEnv !== "production") {
    try { verificationSecret = (await requestEmailVerification(user.id)).secret; } catch { verificationSecret = undefined; }
  } else {
    // В боевом режиме письмо с подтверждением уходит уже после ответа: регистрация не должна
    // висеть или падать из-за медленной почты, а after() следит, чтобы хостинг дождался отправки.
    after(async () => {
      try { await requestEmailVerification(user.id); } catch { /* письмо можно запросить повторно из профиля */ }
    });
  }
  const response = Response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, verificationSecret });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
});
