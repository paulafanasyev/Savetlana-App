import { requireSellerServer } from "@/lib/auth";
import { getOrdersForSeller } from "@/lib/domains/orders";
import { rub, orderStatusLabel, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SellerOrdersPage() {
  const { sellerId } = await requireSellerServer();
  const orders = await getOrdersForSeller(sellerId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Заказы покупателей</h1>
      {orders.length === 0 ? (
        <div className="card p-10 text-center text-ink-soft">Заказов пока нет.</div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-bold text-ink">{o.number}</div>
                  <div className="text-xs text-ink-soft">{o.buyer.name} · {timeAgo(o.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="chip">{orderStatusLabel(o.status)}</span>
                  <span className="font-bold text-svetlana-700">{rub(o.totalKopecks)}</span>
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                {o.items.map((i) => (
                  <li key={i.id}>
                    {i.titleSnapshot} × {i.quantity} — {rub(i.priceKopecks * i.quantity)}
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-ink-soft">
                Оплата: {o.payment ? o.payment.status : "нет данных"}
                {o.shipment ? ` · Доставка: ${o.shipment.carrierName} — ${o.shipment.status}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
