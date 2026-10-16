import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { leaveServiceReview } from "@/lib/domains/service-reviews";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Заказчик оставляет отзыв о работе исполнителя после принятой работы. */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`service-review:${user.id}`, 5, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ rating?: unknown; text?: unknown }>(request).catch(() => ({} as { rating?: unknown; text?: unknown }));
  try {
    const result = await leaveServiceReview(user.id, params.id, body);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
