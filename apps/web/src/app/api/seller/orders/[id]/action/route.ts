import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireVerifiedSeller, ApiError } from "@/lib/auth";
import { performSellerOrderAction } from "@/lib/domains/seller-order-actions";
import { isSellerOrderAction } from "@/lib/domains/order-rules";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/**
 * Отказ от оплаченного заказа и обработка возврата продавцом. Деньги
 * покупателю возвращаются автоматически через тот же банк.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { sellerId, user } = await requireVerifiedSeller(request, "обрабатывать заказы");
  if (!rateLimit(`seller-order-action:${sellerId}`, 30, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ action?: unknown; reason?: unknown; comment?: unknown }>(request);
  if (!isSellerOrderAction(body.action)) throw new ApiError(400, "Неизвестное действие");
  try {
    const result = await performSellerOrderAction({
      orderId: params.id,
      sellerId,
      actorId: user.id,
      action: body.action,
      reason: body.reason,
      comment: body.comment,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
