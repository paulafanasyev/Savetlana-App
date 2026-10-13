import { requireSellerServer } from "@/lib/auth";
import { getOrdersForSeller } from "@/lib/domains/orders";
import { rub, timeAgo } from "@/lib/format";
import { orderStatusLabel, paymentStatusLabel, shipmentStatusLabel } from "@/lib/labels";
import { deliveryLabel } from "@/lib/delivery-options";
import { isLiveDeployment } from "@/lib/live-mode";
import { FulfillActions } from "./FulfillActions";

export const dynamic = "force-dynamic";

// Адрес и телефон покупателя продавец видит только после оплаты заказа.
const HIDE_CONTACTS = ["CREATED", "PAYMENT_PENDING", "CANCELLED"];

interface DeliveryInfo {
  deliveryMethod?: string;
  city?: string;
  street?: string;
  house?: string;
  apartment?: string;
  zip?: string;
  recipientName?: string;
  phone?: string;
}

function parseDelivery(raw: string | null | undefined): DeliveryInfo {
  try {
    const value = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" ? (value as DeliveryInfo) : {};
  } catch {
    return {};
  }
}

function addressLine(d: DeliveryInfo): string {
  return [d.zip, d.city, d.street, d.house ? `д. ${d.house}` : "", d.apartment ? `кв. ${d.apartment}` : ""].filter(Boolean).join(", ");
}

export default async function SellerOrdersPage() {
  const { sellerId } = await requireSellerServer();
  const orders = await getOrdersForSeller(sellerId);
  const allowTestCarrier = !isLiveDeployment();
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Заказы покупателей</h1>
      {orders.length === 0 ? <p className="text-ink-faint">Заказов пока нет.</p> : (
        <div className="space-y-4">
          {orders.map((order) => {
            const delivery = parseDelivery(order.deliveryAddress);
            const method = delivery.deliveryMethod ?? "PICKUP";
            const showContacts = !HIDE_CONTACTS.includes(order.status);
            const address = addressLine(delivery);
            return (
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
                  {order.items.map((item) => <li key={item.id}>{item.titleSnapshot} × {item.quantity}: {rub(item.priceKopecks * item.quantity)}</li>)}
                </ul>
                <div className="rounded-lg bg-surface-muted p-3 text-sm">
                  <div className="font-medium">
                    {deliveryLabel(method)}
                    {order.deliveryKopecks > 0 ? ` · ${rub(order.deliveryKopecks)} включено в заказ` : ""}
                  </div>
                  {showContacts ? (
                    <div className="mt-1 space-y-0.5 text-ink-soft">
                      {method === "SELLER" && <div>Адрес: {address || "не указан"}</div>}
                      {method === "PICKUP" && <div>Напишите покупателю, куда и когда забрать заказ.</div>}
                      <div>Получатель: {delivery.recipientName || order.buyer.name || "не указан"}</div>
                      {delivery.phone && <div>Телефон: <a className="underline" href={`tel:${delivery.phone.replace(/[^\d+]/g, "")}`}>{delivery.phone}</a></div>}
                    </div>
                  ) : (
                    <div className="mt-1 text-ink-faint">Адрес и телефон появятся после оплаты.</div>
                  )}
                </div>
                <p className="text-sm text-ink-faint">
                  Оплата: {paymentStatusLabel(order.payment?.status)}
                  {order.shipment ? ` · Отправление: ${order.shipment.carrierName}, ${shipmentStatusLabel(order.shipment.status)}` : ""}
                </p>
                <FulfillActions orderId={order.id} status={order.status} hasShipment={Boolean(order.shipment)} shipmentProvider={order.shipment?.providerKey} allowTestCarrier={allowTestCarrier} />
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
