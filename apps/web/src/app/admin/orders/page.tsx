import { listAdminOrders } from "@/lib/domains/admin";
import { countText, orderStatusLabel, rub, timeAgo } from "@/lib/format";
import { paymentStatusLabel, shipmentStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const orders = await listAdminOrders();

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Заказы</h2>
        <p className="text-xs text-ink-soft">Последние {countText(orders.length, ["заказ", "заказа", "заказов"])}</p>
      </div>
      {orders.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Заказов пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Номер</th>
                <th className="px-4 py-2">Покупатель</th>
                <th className="px-4 py-2">Продавец</th>
                <th className="px-4 py-2">Сумма</th>
                <th className="px-4 py-2">Статус</th>
                <th className="px-4 py-2">Оплата</th>
                <th className="px-4 py-2">Доставка</th>
                <th className="px-4 py-2">Создан</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 font-mono text-xs text-ink">{o.number}</td>
                  <td className="px-4 py-2 text-ink-soft">{o.buyer.name}</td>
                  <td className="px-4 py-2 text-ink-soft">{o.sellerProfile.displayName}</td>
                  <td className="px-4 py-2 font-medium text-ink">{rub(o.totalRub)}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-surface px-2 py-0.5 text-xs">
                      {orderStatusLabel(o.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {o.payment ? (
                      <span>
                        {paymentStatusLabel(o.payment.status)}
                        {o.payment.sandbox && <span className="ml-1 text-amber-700">тест</span>}
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {o.shipment ? (
                      <span>
                        {shipmentStatusLabel(o.shipment.status)} · {o.shipment.carrierName}
                        {o.shipment.sandbox && <span className="ml-1 text-amber-700">тест</span>}
                      </span>
                    ) : (
                      <span className="text-ink-faint">не создана</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{timeAgo(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
