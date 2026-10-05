import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { collectEvidence, transitionDispute, getDisputeCase } from "@/lib/domains/disputes";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RESOLVE_STATUSES = ["RESOLVED_BUYER", "RESOLVED_SELLER", "ESCALATED_HUMAN", "CLOSED"];

export const GET = apiRoute(async (request, ctx) => {
  const auth = await requireUser(request);
  const dispute = await getDisputeCase(ctx.params.id, auth.user.id, auth.user.role);
  if (!dispute) throw new ApiError(404, "Спор не найден");
  return Response.json({ dispute });
});

/**
 * Advances a dispute. Only a party to the dispute may act. Audit fix:
 * Dispute.sellerId is a SellerProfile id, so the seller is matched through
 * sellerProfile.userId, not compared with the auth user id.
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("disputes:transition", 10, 60_000)) return tooManyRequests();
  const auth = await requireUser(request);
  const body = await jsonBody<{ to?: string; resolution?: string }>(request);
  if (!RESOLVE_STATUSES.includes(body.to ?? "")) throw new ApiError(400, "Укажите целевой статус спора");

  const dispute = await prisma.dispute.findUnique({ where: { id: ctx.params.id }, include: { sellerProfile: { select: { userId: true } } } });
  if (!dispute) throw new ApiError(404, "Спор не найден");
  const isSeller = dispute.sellerProfile.userId === auth.user.id;
  if (dispute.buyerId !== auth.user.id && !isSeller) throw new ApiError(403, "Нет доступа к этому спору");

  const actorRole = dispute.buyerId === auth.user.id ? "buyer" : "seller";
  if (body.to === "ESCALATED_HUMAN") await collectEvidence(ctx.params.id, auth.user.id);
  const updated = await transitionDispute(ctx.params.id, auth.user.id, actorRole, body.to as never, body.resolution);
  return Response.json({ dispute: updated });
});
