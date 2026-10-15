import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireVerifiedSeller, ApiError } from "@/lib/auth";
import { startPromotion, endPromotion } from "@/lib/domains/seller-promotions";
import { extendPromotion } from "@/lib/domains/promo-extend";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { sellerEndingPromoIds } from "@/lib/domains/seller-badges";
import { PROMO_EXTEND_DAYS } from "@/lib/seller-todo";

export const dynamic = "force-dynamic";

interface Body {
  action?: "start" | "end" | "extend" | "extend_ending";
  productIds?: unknown;
  percent?: unknown;
  days?: unknown;
}

/**
 * Запуск, продление и завершение скидки на выбранные товары продавца.
 * «extend_ending»: продлить все скидки, которые закончатся в течение суток
 * (кнопка в блоке «Что сделать сегодня»), товары сервер находит сам.
 */
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
    if (body.action === "extend") {
      const result = await extendPromotion({ sellerId, productIds: body.productIds, days: body.days });
      return Response.json({ ok: true, ...result });
    }
    if (body.action === "extend_ending") {
      const productIds = await sellerEndingPromoIds(sellerId);
      if (productIds.length === 0) throw new ApiError(400, "Скидок, которые закончатся в течение суток, сейчас нет");
      const result = await extendPromotion({ sellerId, productIds, days: body.days ?? PROMO_EXTEND_DAYS });
      return Response.json({ ok: true, ...result });
    }
    throw new ApiError(400, "Неизвестное действие");
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
