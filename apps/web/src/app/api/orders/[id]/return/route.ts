import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionOrder } from "@/lib/domains/orders";
import { processRefund } from "@/lib/domains/payments";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const REASONS = ["ITEM_NOT_AS_DESCRIBED", "ITEM_DAMAGED", "WRONG_ITEM", "NO_LONGER_NEEDED"];

/**
 * Buyer-initiated return (spec §29). The state machine is the authority —
 * if the order status does not permit RETURN_REQUESTED, the request is
 * rejected with a real reason rather than a fake success.
 *
 * Money actually moves back (P0-7): the Refund row is created here and
 * `processRefund` drives it through the payment provider with an idempotency
 * key, so a retry after a network blip refunds once, not twice.
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

  // Record and execute the money movement. Only a paid order has a charge to
  // refund; anything else stays a return request only.
  const payment = await prisma.payment.findFirst({
    where: { orderId: params.id, status: "SUCCEEDED" },
    select: { id: true, amountKopecks: true },
  });
  if (payment) {
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: params.id,
        amountKopecks: payment.amountKopecks,
        reason: body.reason,
      },
    });
    await processRefund({
      refundId: refund.id,
      actorId: user.id,
      actorRole: "buyer",
    }).catch((error) => {
      // The return is recorded; a provider failure must not lose the buyer's
      // request. The refund stays FAILED and surfaces to the seller/admin.
      console.error("[return] refund processing failed", error);
    });
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
