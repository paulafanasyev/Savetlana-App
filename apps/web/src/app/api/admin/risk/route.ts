import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { listRiskEvents, reviewRiskEvent } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:risk", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json({ items: await listRiskEvents(100) });
});

/**
 * Mark a risk event reviewed. The decision is explainable and auditable
 * (spec §27): the admin records what action was taken and why, and the
 * event can never be silently dropped.
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("admin:risk-review", 10, 60_000)) return tooManyRequests();
  const ctx = await requireAdmin(request);
  const body = await jsonBody<{ riskEventId?: string; decision?: string }>(request);

  if (!body.riskEventId) throw new ApiError(400, "Укажите riskEventId");
  if (!body.decision) throw new ApiError(400, "Укажите decision");

  return Response.json(
    await reviewRiskEvent(body.riskEventId, body.decision.slice(0, 200), ctx.user.id)
  );
});
