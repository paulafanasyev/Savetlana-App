export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiRoute } from "@/lib/api-helpers";
import { resetPassword } from "@/lib/domains/account-recovery";
import { AUTH_LIMITS, clientIp, consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";

/**
 * POST /api/auth/password-reset/confirm
 * Body: { ticket, password }
 * Consumes the single-use ticket and sets the new password. All existing
 * sessions are revoked, so recovery invalidates prior logins.
 */
export const POST = apiRoute(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const limit = AUTH_LIMITS.passwordReset;
  const decision = await consumeRateLimit(
    `reset-confirm:${clientIp(request)}`,
    limit.limit,
    limit.windowMs,
  );
  if (!decision.allowed) return tooMany(decision);

  await resetPassword(ticket, password);
  return Response.json({ ok: true, message: "Пароль изменён. Войдите с новым паролем." });
});
