import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { getGiftContext, upcomingGiftEvents } from "@/lib/domains/gifts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("gifts:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const [giftContext, upcoming] = await Promise.all([
    getGiftContext(ctx.user.id),
    upcomingGiftEvents(ctx.user.id),
  ]);
  return Response.json({ ...giftContext, upcoming });
});

/**
 * Creates a gift event (a date to remember). stealthMode defaults to ON, so
 * the recipient never sees the gift (spec §21).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("gifts:create", 10, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const body = await jsonBody<{
    recipientName?: string;
    recipientRelationship?: string;
    occasion?: string;
    eventDate?: string;
    budgetRubles?: number;
    interests?: string[];
    wishlistHint?: string;
    stealthMode?: boolean;
  }>(request);

  if (!body.recipientName?.trim()) throw new ApiError(400, "Укажите получателя подарка");
  if (!body.occasion?.trim()) throw new ApiError(400, "Укажите повод (день рождения, годовщина…)");
  const eventDate = body.eventDate ? new Date(body.eventDate) : null;
  if (!eventDate || Number.isNaN(eventDate.getTime())) {
    throw new ApiError(400, "Укажите корректную дату события");
  }

  const event = await prisma.giftEvent.create({
    data: {
      creatorId: ctx.user.id,
      recipientName: body.recipientName.trim(),
      recipientRelationship: body.recipientRelationship?.trim() || null,
      occasion: body.occasion.trim(),
      eventDate,
      budgetKopecks: body.budgetRubles ? Math.round(body.budgetRubles * 100) : 0,
      interests: JSON.stringify(body.interests ?? []),
      wishlistHint: body.wishlistHint?.trim() || null,
      // Privacy mode is opt-out, never opt-in.
      stealthMode: body.stealthMode !== false,
    },
  });
  return Response.json({ event }, { status: 201 });
});
