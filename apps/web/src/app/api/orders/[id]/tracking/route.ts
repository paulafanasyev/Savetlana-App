import { apiRoute, tooManyRequests, rateLimit } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncTracking } from "@/lib/domains/delivery";
import { hasServiceReview } from "@/lib/domains/service-reviews";
import { serviceMeta } from "@/lib/service-deal";

export const dynamic = "force-dynamic";

// Статусы, для которых нужна запись «доставлено / работа сдана».
const AFTER_DELIVERY = ["DELIVERED", "COMPLETED", "DISPUTED"];

/**
 * Unified tracking screen (spec §24). The buyer sees the order status, the
 * carrier, the tracking number, ETA and the event timeline. Status always
 * comes from the carrier — the route never invents a status (spec §123).
 * Also returns the price breakdown and which products the buyer has already
 * reviewed, so the order page can offer a review form after delivery.
 * deliveredAt: когда заказ доставлен, чтобы показать дату автоприёмки безопасной сделки.
 * kind: SERVICE для заказа услуги (фриланс), тогда workReport: что исполнитель написал при сдаче,
 * и serviceReviewed: заказчик уже оставил отзыв о работе.
 */
export const GET = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  if (!rateLimit(`tracking:${user.id}`, 60, 60_000)) return tooManyRequests();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.id },
    select: {
      id: true,
      number: true,
      status: true,
      buyerId: true,
      totalKopecks: true,
      subtotalKopecks: true,
      deliveryKopecks: true,
      currency: true,
      deliveryAddress: true,
      items: { select: { id: true, productId: true, titleSnapshot: true, quantity: true, priceKopecks: true } },
      payment: { select: { status: true, sandbox: true } },
    },
  });
  if (order.buyerId !== user.id) {
    return Response.json({ error: "Нет доступа к этому заказу", code: "forbidden" }, { status: 403 });
  }
  const meta = serviceMeta(order.deliveryAddress);

  let shipment = meta
    ? null
    : await prisma.deliveryShipment.findFirst({
        where: { orderId: order.id },
        include: { events: { orderBy: { occurredAt: "asc" } } },
      });

  // Refresh from the carrier when a shipment exists. A carrier outage must not
  // break the screen: fall back to the last known stored state.
  if (shipment) {
    try {
      shipment = await syncTracking(shipment.id);
    } catch {
      // Keep the persisted timeline; the UI shows the last known status.
    }
  }

  const reviews = await prisma.review.findMany({
    where: { orderId: order.id, authorId: user.id },
    select: { productId: true, isHidden: true },
  });

  const delivered = AFTER_DELIVERY.includes(order.status)
    ? await prisma.orderHistory.findFirst({
        where: { orderId: order.id, toStatus: "DELIVERED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, reason: true },
      })
    : null;
  const workReport = meta && delivered?.reason ? delivered.reason.replace(/^работа сдана:\s*/i, "").trim() || null : null;
  const serviceReviewed = meta && order.status === "COMPLETED" ? await hasServiceReview(meta.performerId, order.number) : false;

  return Response.json({
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      totalKopecks: order.totalKopecks,
      subtotalKopecks: order.subtotalKopecks,
      deliveryKopecks: order.deliveryKopecks,
      currency: order.currency,
      items: order.items,
      payment: order.payment ?? null,
      deliveredAt: order.status === "DELIVERED" ? delivered?.createdAt ?? null : null,
      kind: meta ? "SERVICE" : "GOODS",
      serviceTitle: meta?.title ?? null,
      workReport,
      serviceReviewed,
    },
    reviewedProductIds: reviews.map((r) => r.productId),
    // Отзывы, скрытые антифродом до проверки: автору честно пишем «на проверке».
    moderatedProductIds: reviews.filter((r) => r.isHidden).map((r) => r.productId),
    shipment: shipment
      ? {
          id: shipment.id,
          carrierName: shipment.carrierName,
          trackingNumber: shipment.trackingNumber,
          status: shipment.status,
          eta: shipment.eta,
          sandbox: shipment.sandbox,
          events: shipment.events.map((e) => ({
            id: e.id,
            status: e.status,
            description: e.description,
            occurredAt: e.occurredAt,
          })),
        }
      : null,
    // Honest marker: no shipment yet means the seller has not handed the order
    // over to a carrier. Do not present a fabricated ETA.
    trackingReady: Boolean(shipment?.trackingNumber),
  });
});
