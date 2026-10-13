import { requireSellerServer } from "@/lib/auth";
import { getOrdersForSeller } from "@/lib/domains/orders";
import { rub, timeAgo } from "@/lib/format";
import { orderStatusLabel, paymentStatusLabel, shipmentStatusLabel } from "@/lib/labels";
import { FulfillActions } from "./FulfillActions";

export const dynamic = "force-dynamic";

export default async function SellerOrdersPage() {
  const { sellerId } = await requireSellerServer();
  const orders = await getOrdersForSeller(sellerId);
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Заказы покупателей</h1>
      {orders.length === 0 ? <p className="text-ink-faint">Заказов пока нет.</p> : (
        <div className="space-y-4">
          {orders.map((order) => (
            <article className="card space-y-3 p-5" key={order.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>{order.number}</b>
                  <div className="text-sm text-ink-faint">{order.buyer.name ?? order.buyer.email} · {timeAgo(order.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div>{orderStatusLabel(order.status)}</div>
                  <b>{rub(order.totalKopecks)}</b>
                </div>
              </div>
              <ul className="text-sm">
                {order.items.map((item) => <li key={item.id}>{item.titleSnapshot} × {item.quantity} — {rub(item.priceKopecks * item.quantity)}</li>)}
              </ul>
              <p className="text-sm text-ink-faint">
                Оплата: {paymentStatusLabel(order.payment?.status)}
                {order.shipment ? ` · Доставка: ${order.shipment.carrierName} — ${shipmentStatusLabel(order.shipment.status)}` : " · Доставка ещё не создана"}
              </p>
              <FulfillActions orderId={order.id} status={order.status} hasShipment={Boolean(order.shipment)} shipmentProvider={order.shipment?.providerKey} />
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
