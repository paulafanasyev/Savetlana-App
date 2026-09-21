import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getOrdersForBuyer } from "@/lib/domains/orders";
import { fromKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const orders = await getOrdersForBuyer(user.id);
  return Response.json({
    items: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      totalKopecks: o.totalKopecks,
      totalRub: fromKopecks(o.totalKopecks),
      createdAt: o.createdAt,
      seller: { id: o.sellerProfile.id, name: o.sellerProfile.displayName },
      itemsCount: o.items.length,
      payment: o.payment ? { status: o.payment.status, sandbox: o.payment.sandbox } : null,
      shipment: o.shipment
        ? {
            carrier: o.shipment.carrierName,
            trackingNumber: o.shipment.trackingNumber,
            status: o.shipment.status,
            eta: o.shipment.eta,
          }
        : null,
    })),
  });
});
