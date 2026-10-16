import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { sendBid } from "@/lib/domains/freelance-bids";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

interface Body {
  price?: unknown;
  days?: unknown;
  text?: unknown;
}

/** Исполнитель предлагает цену и срок по заказу услуги. */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`classified-bids:${user.id}`, 10, 60_000)) return tooManyRequests();
  const body = await jsonBody<Body>(request).catch(() => ({} as Body));
  try {
    await sendBid({ id: user.id, name: user.name }, params.id, body);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
