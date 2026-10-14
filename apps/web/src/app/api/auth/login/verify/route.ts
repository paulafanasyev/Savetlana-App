import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, clientIp, tooMany } from "@/lib/domains/rate-limits";
import { inspectLogin } from "@/lib/domains/account-security";
import { loginCodeHash, normalizeCode, verifyLoginChallenge } from "@/lib/domains/login-challenge";
import { finishLogin } from "@/lib/login-finish";

export const dynamic = "force-dynamic";

/** Второй шаг входа с нового устройства: код из письма. */
export const POST = apiRoute(async (request) => {
  const body = await jsonBody<{ challenge?: string; code?: string }>(request);
  const challenge = String(body.challenge ?? "").trim().toLowerCase();
  const code = normalizeCode(body.code);
  const ip = clientIp(request);
  // Перебор кода: не больше 5 попыток на один вызов и 20 с одного адреса за 10 минут.
  const perChallenge = await consumeRateLimit(`login-code:${loginCodeHash(challenge, "").slice(0, 24)}`, 5, 10 * 60_000);
  if (!perChallenge.allowed) return tooMany(perChallenge);
  const perIp = await consumeRateLimit(`login-code:ip:${ip}`, 20, 10 * 60_000);
  if (!perIp.allowed) return tooMany(perIp);

  const userId = await verifyLoginChallenge(challenge, code);
  if (!userId) {
    return Response.json({ error: "Код не подошёл или устарел. Проверьте письмо или войдите заново, чтобы получить новый код.", code: "bad_code" }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.isBlocked) return Response.json({ error: "Аккаунт заблокирован", code: "blocked" }, { status: 403 });
  const login = await inspectLogin(user.id, request.headers.get("user-agent"), ip).catch(() => null);
  return finishLogin(user, login, { method: "code" });
});
