import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { recommendForUser, recordRecommendationFeedback } from "@/lib/domains/recommendations";

export const dynamic = "force-dynamic";

const SIGNALS = [
  "useful",
  "not_useful",
  "too_expensive",
  "not_my_style",
  "not_suitable",
  "already_have",
];

/**
 * Explainable recommendations: candidate generation + ranking + safety, each
 * item carrying a "why" (spec §28, §53). Personalization is gated on the
 * user's consent — with it revoked, the engine degrades to neutral ranking.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("recommendations:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "8");
  const contextProductId = url.searchParams.get("contextProductId") ?? undefined;

  const result = await recommendForUser(ctx.user.id, {
    limit: Number.isFinite(limit) ? limit : undefined,
    contextProductId,
  });
  return Response.json(result);
});

/**
 * User feedback on a recommendation (spec §32). Used to re-rank, never to
 * train model weights automatically.
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("recommendations:feedback", 20, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const body = await jsonBody<{ productId?: string; signal?: string; comment?: string }>(request);

  if (!body.productId) throw new ApiError(400, "Укажите товар");
  if (!SIGNALS.includes(body.signal ?? "")) {
    throw new ApiError(400, "Недопустимый сигнал обратной связи");
  }

  const result = await recordRecommendationFeedback(
    ctx.user.id,
    body.productId,
    body.signal as never,
    body.comment
  );
  return Response.json(result);
});
