import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { createGroupGift } from "@/lib/domains/gifts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Turns a gift event into a group gift. Only the organiser may set the target,
 * and no money moves here — contributions are proposals until each participant
 * confirms their own amount (spec §22).
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("gifts:group-create", 10, 60_000)) return tooManyRequests();
  const auth = await requireBuyer(request);
  const body = await jsonBody<{ targetRubles?: number }>(request);

  if (!body.targetRubles || body.targetRubles <= 0) {
    throw new ApiError(400, "Укажите сумму подарка");
  }
  const event = await prisma.giftEvent.findUniqueOrThrow({ where: { id: ctx.params.id } });
  if (event.creatorId !== auth.user.id) {
    throw new ApiError(403, "Только организатор может создавать групповой подарок");
  }

  const group = await createGroupGift(ctx.params.id, body.targetRubles, auth.user.id);
  return Response.json({ group }, { status: 201 });
});
