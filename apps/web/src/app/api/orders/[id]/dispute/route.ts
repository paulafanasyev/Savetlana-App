import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { openDispute } from "@/lib/domains/disputes";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const REASONS = [
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_DAMAGED",
  "PAYMENT_DISPUTE",
  "RETURN_DISPUTE",
  "DELIVERY_DISPUTE",
];

/**
 * Open a dispute from the buyer side (spec §42). Svetlana only opens the case
 * and collects evidence — adjudication is escalated to a human when needed.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ reason?: string; description?: string }>(request);
  if (!body.reason || !REASONS.includes(body.reason)) {
    throw new ApiError(400, "Укажите причину спора");
  }
  const description = body.description?.trim();
  if (!description || description.length < 10) {
    throw new ApiError(400, "Опишите проблему (минимум 10 символов)");
  }

  const dispute = await openDispute({
    orderId: params.id,
    buyerId: user.id,
    reason: body.reason as never,
    description: description.slice(0, 2000),
  });

  await notify({
    userId: user.id,
    kind: "dispute_update",
    title: `Открыт спор по заказу ${dispute.orderId}`,
    body: "Спор передан на сбор доказательств. Если потребуется, подключится специалист.",
    url: `/orders/${params.id}`,
  });
  return Response.json({ ok: true, disputeId: dispute.id, status: dispute.status });
});
