import { apiRoute } from "@/lib/api-helpers";
import { resolveSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NO_UNREAD, splitUnread } from "@/lib/unread";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await resolveSession(request);
  if (!user) return Response.json({ user: null });
  const [sellerProfile, unreadRows] = await Promise.all([
    prisma.sellerProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, displayName: true, slug: true },
    }),
    // Счётчик для шапки не должен ломать вход: при ошибке просто без цифр.
    prisma.notification
      .groupBy({ by: ["kind"], where: { userId: user.id, readAt: null }, _count: { _all: true } })
      .catch(() => null),
  ]);
  const unread = unreadRows ? splitUnread(unreadRows.map((r) => ({ kind: r.kind, count: r._count._all }))) : NO_UNREAD;
  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    sellerProfile,
    unread,
  });
});
