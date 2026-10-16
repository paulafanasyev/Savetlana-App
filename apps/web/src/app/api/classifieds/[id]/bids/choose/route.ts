import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { chooseBid } from "@/lib/domains/freelance-bids";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Заказчик выбирает исполнителя из предложений. */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`classified-bid-choose:${user.id}`, 10, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ applicantId?: unknown }>(request).catch(() => ({} as { applicantId?: unknown }));
  const applicantId = typeof body.applicantId === "string" ? body.applicantId : "";
  if (!applicantId) throw new ApiError(400, "Не указан исполнитель");
  try {
    const result = await chooseBid(user.id, params.id, applicantId);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
