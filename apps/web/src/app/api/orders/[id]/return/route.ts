import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionOrder } from "@/lib/domains/orders";
import { processRefund } from "@/lib/domains/payments";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const REASONS = ["ITEM_NOT_AS_DESCRIBED", "ITEM_DAMAGED", "WRONG_ITEM", "NO_LONGER_NEEDED"];

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

  const payment = await prisma.payment.findFirst({
    where: { orderId: params.id, status: "SUCCEEDED" },
    select: { id: true, amountKopecks: true },
  });
  if (payment) {
    // Audit fix: a repeated return request must never create a second refund.
    const reason = body.reason;
    const refund = await prisma.$transaction(async (tx) => {
      const active = await tx.refund.findFirst({
        where: { orderId: params.id, paymentId: payment.id, status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] } },
        orderBy: { createdAt: "asc" },
      });
      if (active) return active;
      const summed = await tx.refund.aggregate({
        where: { orderId: params.id, paymentId: payment.id, status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] } },
        _sum: { amountKopecks: true },
      });
      const remaining = payment.amountKopecks - (summed._sum.amountKopecks ?? 0);
      if (remaining <= 0) return null;
      return tx.refund.create({
        data: { paymentId: payment.id, orderId: params.id, amountKopecks: remaining, reason },
      });
    });
    // Only a still-pending refund is sent to the provider; PROCESSING/SUCCEEDED are never re-submitted.
    if (refund && refund.status === "PENDING") {
      await processRefund({ refundId: refund.id, actorId: user.id, actorRole: "buyer" }).catch((error) => {
        console.error("[return] refund processing failed", error);
      });
    }
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
