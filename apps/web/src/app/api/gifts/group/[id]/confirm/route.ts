import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { confirmContribution } from "@/lib/domains/gifts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * A participant's explicit opt-in. Only the participant themselves may
 * confirm — the organiser cannot confirm on their behalf, and nothing is
 * charged without this flag (spec §22, §147).
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("gifts:confirm", 20, 60_000)) return tooManyRequests();
  const auth = await requireBuyer(request);

  const existing = await prisma.giftContribution.findUnique({
    where: { groupId_participantId: { groupId: ctx.params.id, participantId: auth.user.id } },
  });
  if (!existing) throw new ApiError(404, "Участие не найдено — сначала предложите сумму");
  if (existing.isConfirmed) {
    return Response.json({
      contribution: existing,
      collectedKopecks: 0,
      targetMet: false,
      alreadyConfirmed: true,
    });
  }

  const result = await confirmContribution(ctx.params.id, auth.user.id);
  return Response.json(result);
});
