import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { sendToApplicant, sendToAuthor } from "@/lib/domains/classified-replies";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

interface Body {
  text?: unknown;
  applicantId?: unknown;
}

/** Отклик на объявление или ответ автора откликнувшемуся (если указан applicantId). */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`classified-replies:${user.id}`, 20, 60_000)) return tooManyRequests();
  const id = params.id;
  const body = await jsonBody<Body>(request).catch(() => ({} as Body));
  try {
    if (typeof body.applicantId === "string" && body.applicantId) {
      await sendToApplicant(user.id, id, body.applicantId, body.text);
    } else {
      await sendToAuthor({ id: user.id, name: user.name }, id, body.text);
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
