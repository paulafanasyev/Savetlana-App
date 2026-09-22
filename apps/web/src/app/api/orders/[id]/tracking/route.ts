import { apiRoute, tooManyRequests, rateLimit } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncTracking } from "@/lib/domains/delivery";

export const dynamic = "force-dynamic";

/**
 * Unified tracking screen (spec §24). The buyer sees the order status, the
 * carrier, the tracking number, ETA and the event timeline. Status always
 * comes from the carrier — the route never invents a status (spec §123).
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
      currency: true,
      items: { select: { id: true, titleSnapshot: true, quantity: true, priceKopecks: true } },
    },
  });
  if (order.buyerId !== user.id) {
    return Response.json({ error: "Нет доступа к этому заказу", code: "forbidden" }, { status: 403 });
  }

  let shipment = await prisma.deliveryShipment.findFirst({
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

  return Response.json({
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      totalKopecks: order.totalKopecks,
      currency: order.currency,
      items: order.items,
    },
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
