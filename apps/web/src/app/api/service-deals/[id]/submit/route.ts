import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { submitWork } from "@/lib/domains/service-deals";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Исполнитель сдаёт работу по безопасной сделке. */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`service-submit:${user.id}`, 10, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ text?: unknown }>(request).catch(() => ({} as { text?: unknown }));
  try {
    const result = await submitWork(params.id, user.id, body.text);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
