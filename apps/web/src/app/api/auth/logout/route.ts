import { apiRoute } from "@/lib/api-helpers";
import { clearSessionCookie, resolveSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const { session } = await resolveSession(request);
  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookie(env.isProduction));
  return response;
});
