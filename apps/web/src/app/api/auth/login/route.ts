import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { promoteConfiguredAdmin } from "@/lib/domains/admin-bootstrap";
import { consumeRateLimit, clientIp, loginBuckets, recordAuthOutcome, AUTH_LIMITS, tooMany } from "@/lib/domains/rate-limits";
import { inspectLogin } from "@/lib/domains/account-security";
import { startLoginChallenge } from "@/lib/domains/login-challenge";
import { adminTelegramSecondFactor, type AdminSecondFactor } from "@/lib/domains/admin-2fa";
import { finishLogin } from "@/lib/login-finish";

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
  // Устройство сравниваем с прошлыми входами до записи новой сессии.
  const login = await inspectLogin(user.id, request.headers.get("user-agent"), ip).catch(() => null);
  // Администратор с привязанным Telegram: код при каждом входе, без кода не пускаем.
  const second: AdminSecondFactor = await adminTelegramSecondFactor(user, login).catch((): AdminSecondFactor => ({ kind: user.role === "ADMIN" ? "failed" : "none" }));
  if (second.kind === "sent") {
    return Response.json({ needsCode: true, reason: "admin", challenge: second.challenge.challenge, sentTo: second.challenge.sentTo, device: login?.device ?? "" });
  }
  if (second.kind === "failed") {
    return Response.json(
      { error: "Не удалось отправить код в Telegram. Попробуйте войти ещё раз через минуту. Если доступа к Telegram нет, воспользуйтесь аварийным восстановлением доступа.", code: "second_factor_unavailable" },
      { status: 503 },
    );
  }
  // Незнакомое устройство: пароля мало, нужен код из письма. Если письмо не
  // ушло (почта не настроена), пускаем по паролю и предупреждаем владельца.
  if (login?.isNew) {
    const challenge = await startLoginChallenge(user, login).catch(() => null);
    if (challenge) {
      return Response.json({ needsCode: true, challenge: challenge.challenge, sentTo: challenge.sentTo, device: login.device });
    }
  }
  return finishLogin(user, login, { method: "password" });
});
