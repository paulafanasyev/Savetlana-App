export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { changePassword } from "@/lib/domains/password-change";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";

/**
 * POST /api/auth/password-change
 * Body: { currentPassword, newPassword }
 * Смена пароля из профиля. Не больше 5 попыток за 15 минут, чтобы текущий
 * пароль нельзя было подобрать перебором с открытой сессии.
 */
export const POST = apiRoute(async (request: Request) => {
  const ctx = await requireUser(request);
  const decision = await consumeRateLimit(`password-change:${ctx.user.id}`, 5, 15 * 60_000);
  if (!decision.allowed) return tooMany(decision);

  const body = await request.json().catch(() => ({}));
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const result = await changePassword(ctx.user.id, ctx.session.id, current, next);
  return Response.json({
    ok: true,
    message:
      result.otherSessionsEnded > 0
        ? `Пароль изменён. Завершено входов на других устройствах: ${result.otherSessionsEnded}.`
        : "Пароль изменён.",
  });
});
