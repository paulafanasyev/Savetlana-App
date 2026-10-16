import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { buyPromotion, myPromotions } from "@/lib/domains/promotions";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Мои продвижения. */
export const GET = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  return Response.json({ promotions: await myPromotions(user.id) });
});

/** Купить или продлить продвижение: { kind, itemId, planId }. Оплата пока тестовая. */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`promo:${user.id}`, 20, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ kind?: unknown; itemId?: unknown; planId?: unknown }>(request).catch(() => ({} as { kind?: unknown }));
  try {
    return Response.json({ promotion: await buyPromotion(user.id, body) }, { status: 201 });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
