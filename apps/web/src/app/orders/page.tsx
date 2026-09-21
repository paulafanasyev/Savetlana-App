"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { rub, orderStatusLabel, timeAgo } from "@/lib/format";

interface OrderRow {
  id: string;
  number: string;
  status: string;
  totalKopecks: number;
  createdAt: string;
  seller: { id: string; name: string };
  itemsCount: number;
  payment: { status: string; sandbox: boolean } | null;
  shipment: { carrier: string; trackingNumber: string | null; status: string; eta: string | null } | null;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  useEffect(() => {
    void fetch("/api/orders")
      .then((r) => (r.status === 401 ? null : r.json()))
      .then((d) => setOrders(d?.items ?? null))
      .catch(() => setOrders(null));
  }, []);

  if (!orders) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-ink">Заказы</h1>
          <p className="mt-2 text-ink-soft">Войдите в аккаунт, чтобы видеть свои заказы.</p>
          <Link href="/login" className="btn btn-primary mt-4 inline-flex">
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-ink">Заказов пока нет</h1>
          <p className="mt-2 text-ink-soft">Светлана поможет подобрать первый товар.</p>
          <Link href="/catalog" className="btn btn-primary mt-4 inline-flex">
            В каталог
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Мои заказы</h1>
      <div className="space-y-3">
        {orders.map((o) => (
          <div key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-sm font-bold text-ink">{o.number}</div>
                <div className="text-xs text-ink-soft">{o.seller.name} · {timeAgo(o.createdAt)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="chip">{orderStatusLabel(o.status)}</span>
                <span className="font-bold text-svetlana-700">{rub(o.totalKopecks)}</span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-3">
              <div>
                Оплата:{" "}
                {o.payment ? (
                  <span className={o.payment.sandbox ? "text-amber-700" : "text-ink"}>
                    {o.payment.status}
                    {o.payment.sandbox ? " (sandbox)" : ""}
                  </span>
                ) : (
                  "нет данных"
                )}
              </div>
              <div>
                Доставка:{" "}
                {o.shipment ? `${o.shipment.carrier} · ${o.shipment.status}` : "не создана"}
              </div>
              <div>Товаров: {o.itemsCount}</div>
            </div>
            {canCancel(o.status) && (
              <div className="mt-3">
                <CancelButton orderId={o.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function canCancel(status: string): boolean {
  return ["CREATED", "PAYMENT_PENDING", "PAID", "CONFIRMED"].includes(status);
}

function CancelButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  return (
    <button
      className="btn btn-ghost px-3 py-1.5 text-xs text-bad"
      disabled={state === "busy" || state === "ok"}
      onClick={async () => {
        setState("busy");
        const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
        if (res.ok) setState("ok");
        else setState("err");
      }}
    >
      {state === "busy" && "Отменяем…"}
      {state === "idle" && "Отменить заказ"}
      {state === "ok" && "✓ Отменён"}
      {state === "err" && "Не удалось отменить"}
    </button>
  );
}
