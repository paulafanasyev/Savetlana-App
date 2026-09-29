import { apiRoute } from "@/lib/api-helpers";
import { clearSessionCookie, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { audit } from "@/lib/domains/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout-all
 * Revokes every active session for the account, including the current one.
 * Used after a password change / recovery and from the security section of
 * the profile (audit §15: "logout all devices").
 */
export const POST = apiRoute(async (request) => {
  const ctx = await requireUser(request);

  const result = await prisma.session.updateMany({
    where: { userId: ctx.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    action: "sessions_revoked",
    actorId: ctx.user.id,
    actorRole: "user",
    targetType: "user",
    targetId: ctx.user.id,
    after: { sessions: result.count },
  });

  const response = Response.json({ ok: true, revoked: result.count });
  response.headers.append("Set-Cookie", clearSessionCookie(env.isProduction));
  return response;
});
