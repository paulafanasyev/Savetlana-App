import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { hashPassword, createToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { audit } from "@/lib/domains/audit";
import { consumeRateLimit, clientIp, AUTH_LIMITS, tooMany } from "@/lib/domains/rate-limits";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const ip = clientIp(request);
  // Account-creation abuse defence (P0-15): a bot farm must not create
  // unlimited accounts from one IP.
  const decision = await consumeRateLimit(
    `register:ip:${ip}`,
    AUTH_LIMITS.register.limit,
    AUTH_LIMITS.register.windowMs,
  );
  if (!decision.allowed) return tooMany(decision);

  const body = await jsonBody<{
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  }>(request);

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const name = (body.name ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Некорректный email", code: "bad_email" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { error: "Пароль должен быть не короче 8 символов", code: "weak_password" },
      { status: 400 }
    );
  }
  if (name.length < 2) {
    return Response.json({ error: "Укажите имя", code: "bad_name" }, { status: 400 });
  }
  const role = body.role === "SELLER" ? "SELLER" : "BUYER";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: "Пользователь с таким email уже существует", code: "exists" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role,
      isBlocked: false,
    },
  });
  await prisma.profile.create({ data: { userId: user.id } });

  if (role === "SELLER") {
    await prisma.sellerProfile.create({
      data: {
        userId: user.id,
        displayName: name,
        slug: `seller-${user.id.slice(-8)}`,
      },
    });
  }

  const token = await createToken({ sub: user.id, role });
  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 864e5),
    },
  });
  await audit({
    actorId: user.id,
    actorRole: role.toLowerCase(),
    action: "auth.register",
    targetType: "user",
    targetId: user.id,
    after: { role },
  });

  const response = Response.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  response.headers.append("Set-Cookie", setSessionCookie(token, env.isProduction));
  return response;
});
