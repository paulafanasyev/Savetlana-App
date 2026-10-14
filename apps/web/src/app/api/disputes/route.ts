import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { openDispute, listDisputesForUser } from "@/lib/domains/disputes";
import { screenNewDispute } from "@/lib/domains/dispute-screening";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("disputes:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  return Response.json({ items: await listDisputesForUser(ctx.user.id) });
});

const REASONS = [
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCSCRIBED",
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_DAMAGED",
  "PAYMENT_DISPUTE",
  "RETURN_DISPUTE",
  "DELIVERY_DISPUTE",
];

/**
 * Opens a dispute. Svetlana collects evidence and a timeline, but the verdict
 * on a dispute that requires judgement is escalated to a human (spec §42, §91).
 * Антифрод: история покупателя (серийные споры, «не получил» при отметке о
 * вручении) поднимает флаг для модератора. Покупатель этих сигналов не видит,
 * и спор никогда не отклоняется автоматически.
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("disputes:open", 5, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const body = await jsonBody<{
    orderId?: string;
    reason?: string;
    description?: string;
    evidenceUrls?: string[];
  }>(request);

  if (!body.orderId) throw new ApiError(400, "Укажите заказ");
  if (!body.description?.trim()) throw new ApiError(400, "Опишите проблему");
  if (!REASONS.includes(body.reason ?? "")) {
    throw new ApiError(400, "Укажите причину спора");
  }

  const order = await prisma.order.findFirst({
    where: { id: body.orderId, buyerId: ctx.user.id },
  });
  if (!order) throw new ApiError(404, "Заказ не найден");

  const dispute = await openDispute({
    orderId: body.orderId,
    buyerId: ctx.user.id,
    reason: body.reason as never,
    description: body.description.trim(),
    evidenceUrls: body.evidenceUrls,
  });
  // Сбой проверки не должен мешать покупателю открыть спор.
  await screenNewDispute(dispute.id).catch(() => null);
  return Response.json({ dispute }, { status: 201 });
});
