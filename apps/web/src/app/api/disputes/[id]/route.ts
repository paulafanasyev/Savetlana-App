import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { collectEvidence, transitionDispute } from "@/lib/domains/disputes";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RESOLVE_STATUSES = ["RESOLVED_BUYER", "RESOLVED_SELLER", "ESCALATED_HUMAN", "CLOSED"];

/**
 * Advances a dispute. Only a party to the dispute may act; a resolution that
 * requires legal judgement must go through ESCALATED_HUMAN, not an AI verdict
 * (spec §42, §91).
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("disputes:transition", 10, 60_000)) return tooManyRequests();
  const auth = await requireUser(request);
  const body = await jsonBody<{ to?: string; resolution?: string }>(request);

  if (!RESOLVE_STATUSES.includes(body.to ?? "")) {
    throw new ApiError(400, "Укажите целевой статус спора");
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: ctx.params.id } });
  if (!dispute) throw new ApiError(404, "Спор не найден");
  if (dispute.buyerId !== auth.user.id && dispute.sellerId !== auth.user.id) {
    throw new ApiError(403, "Нет доступа к этому спору");
  }

  const actorRole = dispute.buyerId === auth.user.id ? "buyer" : "seller";
  if (body.to === "ESCALATED_HUMAN") {
    // Gather the timeline before handing off to a human arbiter.
    await collectEvidence(ctx.params.id, auth.user.id);
  }

  const updated = await transitionDispute(
    ctx.params.id,
    auth.user.id,
    actorRole,
    body.to as never,
    body.resolution
  );
  return Response.json({ dispute: updated });
});
