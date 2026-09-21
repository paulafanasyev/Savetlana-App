import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { verifyPassword, createToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { audit } from "@/lib/domains/audit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const body = await jsonBody<{ email?: string; password?: string }>(request);
  const email = (body.email ?? "").trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  // Identical response for unknown user / wrong password (no user enumeration).
  const invalid = Response.json(
    { error: "Неверный email или пароль", code: "invalid_credentials" },
    { status: 401 }
  );
  if (!user) return invalid;
  if (user.isBlocked) {
    return Response.json({ error: "Аккаунт заблокирован", code: "blocked" }, { status: 403 });
  }

  const ok = await verifyPassword(body.password ?? "", user.passwordHash);
  if (!ok) return invalid;

  const token = await createToken({ sub: user.id, role: user.role });
  await prisma.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
  await audit({
    actorId: user.id,
    actorRole: user.role.toLowerCase(),
    action: "auth.login",
    targetType: "user",
    targetId: user.id,
  });

  const response = Response.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
});
