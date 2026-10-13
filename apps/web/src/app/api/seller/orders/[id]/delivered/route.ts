import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireVerifiedSeller, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionOrder } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const OWN_DELIVERY_KEYS = ["SELLER_OWN_DELIVERY", "PICKUP", "seller_own", "pickup"];

export const POST = apiRoute(async (request, { params }) => {
  const { sellerId, user } = await requireVerifiedSeller(request, "отмечать доставку");
  if (!rateLimit(`seller-delivered:${sellerId}`, 30, 60_000)) return tooManyRequests();
  const { id } = await Promise.resolve(params);
  const body = await jsonBody<{ note?: string }>(request).catch(() => ({} as { note?: string }));
  const order = await prisma.order.findFirst({ where: { id, sellerId }, include: { shipment: true } });
  if (!order) throw new ApiError(404, "Заказ не найден в вашем кабинете");
  const ownDelivery = !order.shipment || OWN_DELIVERY_KEYS.includes(order.shipment.providerKey);
  if (!ownDelivery) throw new ApiError(400, "Этот заказ должен завершить перевозчик");
  if (!["READY", "HANDED_TO_CARRIER", "IN_TRANSIT"].includes(order.status)) throw new ApiError(409, "Заказ ещё нельзя отметить доставленным");
  const note = body.note?.trim().slice(0, 500) || "Доставлено продавцом";
  // Pickup and own delivery have no carrier callbacks, but still pass through
  // the canonical transitions so every state change is journaled.
  const path = order.status === "READY" ? ["HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"] : order.status === "HANDED_TO_CARRIER" ? ["IN_TRANSIT", "DELIVERED"] : ["DELIVERED"];
  let result: Awaited<ReturnType<typeof transitionOrder>> | null = null;
  for (const to of path) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await transitionOrder({ orderId: id, to: to as any, note, actorId: user.id, actorRole: "seller", actingSellerId: sellerId });
  }
  if (!result) throw new ApiError(409, "Не удалось изменить состояние заказа");
  if (order.shipment) {
    await prisma.$transaction([
      prisma.deliveryShipment.update({ where: { id: order.shipment.id }, data: { status: "DELIVERED" } }),
      prisma.deliveryEvent.create({ data: { shipmentId: order.shipment.id, status: "DELIVERED", description: note } }),
    ]);
  }
  await notify({ userId: order.buyerId, kind: "delivery_update", title: `Заказ ${order.number} доставлен`, body: note, url: `/orders/${order.id}` });
  return Response.json({ ok: true, status: result.order.status });
});
