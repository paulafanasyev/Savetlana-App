import { apiRoute, jsonBody, tooManyRequests, rateLimit } from "@/lib/api-helpers";
import { requireVerifiedSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createShipment } from "@/lib/domains/delivery";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

/**
 * Seller hands an order to a carrier (spec §24, §33). The carrier is chosen
 * from the configured providers; if no real carrier adapter is available the
 * domain throws and the route reports an honest error instead of fabricating a
 * tracking number (spec §49). Requires a verified seller (P0).
 */
export const POST = apiRoute(async (request, { params }) => {
  const { sellerId, user } = await requireVerifiedSeller(request, "отправлять заказы");
  if (!rateLimit(`seller-ship:${sellerId}`, 20, 60_000)) return tooManyRequests();

  const body = await jsonBody<{
    carrier?: string;
    carrierName?: string;
    trackingNumber?: string;
    deliveryKopecks?: number;
    estimatedDelivery?: string;
  }>(request);

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.id },
    select: { id: true, sellerId: true, buyerId: true, number: true, status: true },
  });
  if (order.sellerId !== sellerId) {
    return Response.json({ error: "Это заказ другого продавца", code: "forbidden" }, { status: 403 });
  }

  // Seller may name their own carrier and supply the real tracking number they
  // received from it. Both spellings are accepted; the carrier is preserved.
  const carrier = body.carrier ?? body.carrierName;
  if (!carrier) {
    return Response.json(
      { error: "Укажите перевозчика (carrier)", code: "carrier_required" },
      { status: 400 },
    );
  }
  try {
    const shipment = await createShipment({
      orderId: order.id,
      sellerProfileId: sellerId,
      carrier,
      trackingNumber: body.trackingNumber,
      deliveryKopecks: body.deliveryKopecks,
      estimatedDelivery: body.estimatedDelivery ? new Date(body.estimatedDelivery) : undefined,
    });

    await notify({
      userId: order.buyerId,
      kind: "delivery_update",
      title: `Заказ ${order.number} передан в доставку`,
      body: shipment.sandbox
        ? "Отправление создано в песочнице перевозчика (sandbox). Отслеживание доступно в карточке заказа."
        : "Перевозчик принял отправление. Отслеживание доступно в карточке заказа.",
      url: `/orders/${order.id}`,
    });

    return Response.json({
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      carrierName: shipment.carrierName,
      sandbox: shipment.sandbox,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "carrier unavailable";
    return Response.json(
      {
        error: `Не удалось создать отправление: ${message}`,
        code: "carrier_unavailable",
      },
      { status: 502 }
    );
  }
});
