import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireVerifiedSeller, ApiError } from "@/lib/auth";
import { startPromotion, endPromotion } from "@/lib/domains/seller-promotions";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

interface Body {
  action?: "start" | "end";
  productIds?: unknown;
  percent?: unknown;
  days?: unknown;
}

/** Запуск и завершение скидки на выбранные товары продавца. */
export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireVerifiedSeller(request, "запускать акции");
  if (!rateLimit(`seller-promotions:${sellerId}`, 20, 60_000)) return tooManyRequests();
  const body = await jsonBody<Body>(request).catch(() => ({} as Body));
  try {
    if (body.action === "start") {
      const result = await startPromotion({ sellerId, actorId: user.id, productIds: body.productIds, percent: body.percent, days: body.days });
      return Response.json({ ok: true, ...result });
    }
    if (body.action === "end") {
      const result = await endPromotion({ sellerId, actorId: user.id, productIds: body.productIds });
      return Response.json({ ok: true, ...result });
    }
    throw new ApiError(400, "Неизвестное действие");
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
