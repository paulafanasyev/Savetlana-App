import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { answerRelationshipConfirmation } from "@/lib/domains/relationships";

export const dynamic = "force-dynamic";

/**
 * Mutual confirmation. Only the person the link is ABOUT may decide it — no
 * one verifies a relationship about someone else on their behalf (spec §16).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("relationships:confirm", 10, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const body = await jsonBody<{ token?: string; accept?: boolean }>(request);

  if (!body.token) throw new ApiError(400, "Укажите токен подтверждения");
  if (typeof body.accept !== "boolean") throw new ApiError(400, "Укажите accept");

  const result = await answerRelationshipConfirmation(body.token, ctx.user.id, body.accept);
  return Response.json(result);
});
