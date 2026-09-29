import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { fileAppeal, getDisputeCase } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("disputes:appeal", 3, 60_000)) return tooManyRequests();
  const auth = await requireUser(request);
  const body = await jsonBody<{ reason?: string }>(request);
  if (!body.reason?.trim() || body.reason.trim().length < 20) {
    throw new ApiError(400, "Опишите причину обжалования (минимум 20 символов)");
  }

  const dispute = await getDisputeCase(ctx.params.id, auth.user.id, auth.user.role);
  if (!dispute) throw new ApiError(404, "Спор не найден");

  const result = await fileAppeal(ctx.params.id, auth.user.id, body.reason);
  return Response.json(result);
});
