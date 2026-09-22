import { apiRoute, tooManyRequests, rateLimit } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { transitionOrder } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Seller confirms a paid order and starts fulfillment (spec §152).
 * Transition PAID -> CONFIRMED is a seller-only write; the buyer cannot
 * self-confirm. Requires explicit human action, so the AI never performs it
 * autonomously.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { sellerId, user } = await requireSeller(request);
  if (!rateLimit(`seller-confirm:${sellerId}`, 30, 60_000)) return tooManyRequests();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.id },
    select: { id: true, sellerId: true, buyerId: true, number: true },
  });
  if (order.sellerId !== sellerId) {
    return Response.json({ error: "Это заказ другого продавца", code: "forbidden" }, { status: 403 });
  }

  const result = await transitionOrder({
    orderId: order.id,
    to: "CONFIRMED",
    note: "подтверждён продавцом",
    actorId: user.id,
    actorRole: "seller",
    actingUserId: user.id,
  });
  if (!result.ok) {
    return Response.json(
      { error: `Не удалось подтвердить заказ: ${result.note}`, code: "bad_transition" },
      { status: 409 }
    );
  }

  await notify({
    userId: order.buyerId,
    kind: "order_status",
    title: `Продавец подтвердил заказ ${order.number}`,
    body: "Продавец приступил к сборке заказа.",
    url: `/orders/${order.id}`,
  });

  return Response.json({ ok: true, status: result.order.status });
});
