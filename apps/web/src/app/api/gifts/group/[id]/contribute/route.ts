import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { proposeContribution } from "@/lib/domains/gifts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Proposes a contribution amount. This is NOT a charge: the participant must
 * confirm separately before any payment layer may act on it (spec §22).
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("gifts:contribute", 20, 60_000)) return tooManyRequests();
  const auth = await requireBuyer(request);
  const body = await jsonBody<{ amountRubles?: number }>(request);

  if (!body.amountRubles || body.amountRubles <= 0) {
    throw new ApiError(400, "Укажите сумму участия");
  }

  const group = await prisma.giftGroup.findUniqueOrThrow({
    where: { id: ctx.params.id },
    include: { giftEvent: true },
  });
  // The organiser may adjust the target; a participant joins with their own sum.
  const isOrganiser = group.giftEvent.creatorId === auth.user.id;

  const contribution = await proposeContribution(
    ctx.params.id,
    auth.user.id,
    body.amountRubles
  );
  return Response.json({ contribution, isOrganiser, confirmed: contribution.isConfirmed });
});
