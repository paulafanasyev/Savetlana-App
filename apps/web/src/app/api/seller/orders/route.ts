import { apiRoute } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { getOrdersForSeller } from "@/lib/domains/orders";
import { fromKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  const orders = await getOrdersForSeller(sellerId);
  return Response.json({
    items: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      totalKopecks: o.totalKopecks,
      totalRub: fromKopecks(o.totalKopecks),
      createdAt: o.createdAt,
      buyerName: o.buyer.name,
      items: o.items.map((i) => ({ title: i.titleSnapshot, quantity: i.quantity, priceKopecks: i.priceKopecks })),
      payment: o.payment ? { status: o.payment.status, sandbox: o.payment.sandbox } : null,
      shipment: o.shipment
        ? { carrier: o.shipment.carrierName, trackingNumber: o.shipment.trackingNumber, status: o.shipment.status }
        : null,
    })),
  });
});
