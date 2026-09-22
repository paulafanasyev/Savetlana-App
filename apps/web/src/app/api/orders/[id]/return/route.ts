import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { transitionOrder } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const REASONS = ["ITEM_NOT_AS_DESCRIBED", "ITEM_DAMAGED", "WRONG_ITEM", "NO_LONGER_NEEDED"];

/**
 * Buyer-initiated return (spec §29). The state machine is the authority —
 * if the order status does not permit RETURN_REQUESTED, the request is
 * rejected with a real reason rather than a fake success.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ reason?: string; comment?: string }>(request);
  if (!body.reason || !REASONS.includes(body.reason)) {
    throw new ApiError(400, "Укажите причину возврата");
  }

  const result = await transitionOrder({
    orderId: params.id,
    to: "RETURN_REQUESTED",
    note: body.comment?.slice(0, 1000) ?? `возврат: ${body.reason}`,
    actorId: user.id,
    actorRole: "buyer",
    actingUserId: user.id,
  });
  if (!result.ok) {
    return Response.json(
      { error: `Невозможно оформить возврат: ${result.note}`, code: "bad_transition" },
      { status: 409 }
    );
  }

  await notify({
    userId: user.id,
    kind: "order_status",
    title: `Оформлен возврат по заказу ${result.order.number}`,
    body: "Запрос передан продавцу. Если проблема не решится, можно открыть спор.",
    url: `/orders/${result.order.id}`,
  });
  return Response.json({ ok: true, status: result.order.status });
});
