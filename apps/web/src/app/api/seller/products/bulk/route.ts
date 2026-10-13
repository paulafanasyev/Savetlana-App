import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { getSellerOnboardingGate } from "@/lib/domains/seller-onboarding";
import { applyBulkUpdate } from "@/lib/domains/seller-bulk";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Массовое изменение цен и остатков. Цены опубликованных товаров меняет только проверенный продавец. */
export const POST = apiRoute(async (request) => {
  const { user, sellerId } = await requireSeller(request);
  if (!rateLimit(`seller-bulk:${sellerId}`, 10, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ items?: unknown }>(request);
  const gate = await getSellerOnboardingGate(sellerId);
  try {
    const result = await applyBulkUpdate({ sellerId, actorId: user.id, verified: gate.active, items: body.items });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
