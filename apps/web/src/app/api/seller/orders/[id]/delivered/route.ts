import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireVerifiedSeller, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionOrder, type OrderState } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const OWN_DELIVERY_KEYS = ["SELLER_OWN_DELIVERY", "PICKUP", "seller_own", "pickup"];

/**
 * Канонический путь до «доставлен» для самовывоза и своей доставки продавца.
 * Каждый шаг проходит через transitionOrder, поэтому история заказа полная.
 */
const PATH_TO_DELIVERED: Record<string, OrderState[]> = {
  CONFIRMED: ["PROCESSING", "HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"],
  PROCESSING: ["HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"],
  READY: ["HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"],
  HANDED_TO_CARRIER: ["IN_TRANSIT", "DELIVERED"],
  IN_TRANSIT: ["DELIVERED"],
};

export const POST = apiRoute(async (request, { params }) => {
  const { sellerId, user } = await requireVerifiedSeller(request, "отмечать доставку");
  if (!rateLimit(`seller-delivered:${sellerId}`, 30, 60_000)) return tooManyRequests();
  const { id } = await Promise.resolve(params);
  const body = await jsonBody<{ note?: string }>(request).catch(() => ({} as { note?: string }));
  const order = await prisma.order.findFirst({ where: { id, sellerId }, include: { shipment: true } });
  if (!order) throw new ApiError(404, "Заказ не найден в вашем кабинете");
  const ownDelivery = !order.shipment || OWN_DELIVERY_KEYS.includes(order.shipment.providerKey);
  if (!ownDelivery) throw new ApiError(400, "Этот заказ везёт перевозчик: статус обновится по его данным");
  const path = PATH_TO_DELIVERED[order.status];
  if (!path) throw new ApiError(409, order.status === "PAID" ? "Сначала подтвердите заказ" : "Этот заказ нельзя отметить доставленным");
  const note = body.note?.trim().slice(0, 500) || "Покупатель получил заказ";
  let result: Awaited<ReturnType<typeof transitionOrder>> | null = null;
  for (const to of path) {
    result = await transitionOrder({ orderId: id, to, note, actorId: user.id, actorRole: "seller", actingSellerId: sellerId });
  }
  if (!result) throw new ApiError(409, "Не удалось изменить состояние заказа");
  if (order.shipment) {
    await prisma.$transaction([
      prisma.deliveryShipment.update({ where: { id: order.shipment.id }, data: { status: "DELIVERED" } }),
      prisma.deliveryEvent.create({ data: { shipmentId: order.shipment.id, status: "DELIVERED", description: note } }),
    ]);
  }
  await notify({ userId: order.buyerId, kind: "delivery_update", title: `Заказ ${order.number} доставлен`, body: `${note}. Теперь можно оставить отзыв.`, url: `/orders/${order.id}` });
  return Response.json({ ok: true, status: result.order.status });
});
