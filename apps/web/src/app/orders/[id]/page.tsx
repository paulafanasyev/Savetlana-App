"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { rub, orderStatusLabel, timeAgo } from "@/lib/format";

interface TrackingResponse {
  order: {
    id: string;
    number: string;
    status: string;
    totalKopecks: number;
    currency: string;
    items: { id: string; titleSnapshot: string; quantity: number; priceKopecks: number }[];
  };
  shipment: {
    id: string;
    carrierName: string;
    trackingNumber: string;
    status: string;
    eta: string | null;
    sandbox: boolean;
    events: { id: string; status: string; description: string; occurredAt: string }[];
  } | null;
  trackingReady: boolean;
}

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  CREATED: "Отправление создано",
  HANDED_OVER: "Передано перевозчику",
  IN_TRANSIT: "В пути",
  DELIVERED: "Доставлено",
  RETURNED: "Возврат",
  FAILED: "Ошибка доставки",
  CANCELLED: "Отменено",
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id ?? "";
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/orders/${orderId}/tracking`);
    if (!res.ok) {
      setError("Не удалось загрузить заказ");
      return;
    }
    setData((await res.json()) as TrackingResponse);
  }

  useEffect(() => {
    void load();
    // Tracking is carrier-driven; refresh on focus rather than inventing state.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [orderId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-ink">Заказ не найден</h1>
          <p className="mt-2 text-ink-soft">{error}</p>
          <Link href="/orders" className="btn btn-primary mt-4 inline-flex">
            К списку заказов
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card animate-pulse p-8 text-center text-ink-soft">Загрузка заказа…</div>
      </div>
    );
  }

  const { order, shipment } = data;
  const needsPayment = order.status === "PAYMENT_PENDING" || order.status === "CREATED";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/orders" className="text-sm text-svetlana-700 hover:underline">
        ← Все заказы
      </Link>

      <div className="card mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-bold text-ink">{order.number}</h1>
            <p className="text-xs text-ink-soft">Статус: {orderStatusLabel(order.status)}</p>
          </div>
          <div className="text-right">
            <div className="font-bold text-svetlana-700">{rub(order.totalKopecks)}</div>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <h2 className="text-sm font-bold text-ink">Состав заказа</h2>
          <ul className="mt-2 space-y-2">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">
                  {item.titleSnapshot} × {item.quantity}
                </span>
                <span className="text-ink-soft">{rub(item.priceKopecks * item.quantity)}</span>
              </li>
            ))}
          </ul>
        </div>

        {needsPayment && <PayButton orderId={order.id} onPaid={load} />}
      </div>

      <div className="card mt-3 p-5">
        <h2 className="text-sm font-bold text-ink">Отслеживание доставки</h2>
        {shipment ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip">{SHIPMENT_STATUS_LABEL[shipment.status] ?? shipment.status}</span>
              {shipment.sandbox && (
                <span className="chip bg-amber-100 text-amber-800">sandbox</span>
              )}
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-2">
              <div>Перевозчик: <span className="text-ink">{shipment.carrierName}</span></div>
              <div>
                Трек-номер:{" "}
                <span className="font-mono text-ink">{shipment.trackingNumber || "—"}</span>
              </div>
              <div>
                Ожидаемая доставка:{" "}
                <span className="text-ink">{shipment.eta ? timeAgo(shipment.eta) : "неизвестно"}</span>
              </div>
            </dl>
            {shipment.events.length > 0 && (
              <ol className="mt-4 space-y-3 border-l-2 border-line pl-4">
                {shipment.events.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-svetlana-600" />
                    <div className="text-sm text-ink">{ev.description}</div>
                    <div className="text-xs text-ink-soft">{timeAgo(ev.occurredAt)}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            Продавец ещё не передал заказ перевозчику. Отслеживание появится, когда отправление будет создано.
          </p>
        )}
      </div>
    </div>
  );
}

function PayButton({ orderId, onPaid }: { orderId: string; onPaid: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button
        className="btn btn-primary w-full sm:w-auto"
        disabled={state === "busy" || state === "ok"}
        onClick={async () => {
          setState("busy");
          setMessage(null);
          try {
            const res = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
            const body = await res.json();
            if (!res.ok) {
              setState("err");
              setMessage(body?.error ?? "Оплата не удалась");
              return;
            }
            setState("ok");
            setMessage(
              body.sandbox
                ? "Оплата проведена в песочнице (sandbox). Продавец приступит к сборке."
                : "Оплата подтверждена платёжным партнёром."
            );
            onPaid();
          } catch {
            setState("err");
            setMessage("Не удалось связаться с платёжным сервисом");
          }
        }}
      >
        {state === "busy" && "Оплачиваем…"}
        {state === "idle" && "Оплатить заказ"}
        {state === "ok" && "✓ Оплачено"}
        {state === "err" && "Повторить оплату"}
      </button>
      {message && (
        <p className={`mt-2 text-xs ${state === "ok" ? "text-good" : "text-bad"}`}>{message}</p>
      )}
    </div>
  );
}
