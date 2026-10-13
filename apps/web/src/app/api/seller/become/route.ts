import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/domains/audit";

export const dynamic = "force-dynamic";

/** Открыть кабинет продавца для уже зарегистрированного пользователя. Торговать можно только после проверки анкеты. */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const existing = await prisma.sellerProfile.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (existing) return Response.json({ ok: true, sellerId: existing.id });
  const created = await prisma.sellerProfile.create({
    data: { userId: user.id, displayName: user.name || "Мой магазин", slug: `seller-${user.id.slice(-8)}` },
  });
  // Администратор остаётся администратором, покупатель становится продавцом.
  if (user.role === "BUYER") await prisma.user.update({ where: { id: user.id }, data: { role: "SELLER" } });
  await audit({ actorId: user.id, actorRole: user.role.toLowerCase(), action: "seller.profile_opened", targetType: "seller", targetId: created.id });
  return Response.json({ ok: true, sellerId: created.id });
});
