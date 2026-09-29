export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiRoute } from "@/lib/api-helpers";
import { requestPasswordReset } from "@/lib/domains/account-recovery";
import { AUTH_LIMITS, clientIp, consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";

/**
 * POST /api/auth/password-reset/request
 * Body: { email }
 * Does NOT reveal whether an account exists — the response shape is identical
 * either way, so the endpoint cannot be used for account enumeration.
 */
export const POST = apiRoute(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Укажите email.", code: "bad_email" }, { status: 400 });
  }

  // Rate limit per IP + per requested email: recovery endpoints are abuse magnets.
  const ip = clientIp(request);
  const limit = AUTH_LIMITS.passwordReset;
  for (const bucket of [`reset:${ip}`, `reset:${email}`]) {
    const decision = await consumeRateLimit(bucket, limit.limit, limit.windowMs);
    if (!decision.allowed) return tooMany(decision);
  }

  const result = await requestPasswordReset(email);
  // Identical response whether or not the account exists.
  return Response.json({
    ok: true,
    message: "Если аккаунт существует, ссылка для сброса отправлена на email.",
    devTicket: result.devLink,
  });
});
