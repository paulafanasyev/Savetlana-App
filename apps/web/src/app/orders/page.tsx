"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { rub, timeAgo } from "@/lib/format";
import { orderStatusLabel, paymentStatusLabel, shipmentStatusLabel } from "@/lib/labels";

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

type LoadState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error" }
  | { kind: "ready"; orders: OrderRow[] };

export default function OrdersPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    void fetch("/api/orders")
      .then(async (r) => {
        if (r.status === 401) return setState({ kind: "unauthenticated" });
        if (!r.ok) return setState({ kind: "error" });
        const d = (await r.json()) as { items?: OrderRow[] };
        setState({ kind: "ready", orders: d.items ?? [] });
      })
      .catch(() => setState({ kind: "error" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6" aria-busy="true">
        <h1 className="mb-4 text-2xl font-bold">Мои заказы</h1>
        <div className="card h-24 animate-pulse bg-surface-muted" />
      </div>
    );
  }
  if (state.kind === "unauthenticated") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold">Заказы</h1>
          <p className="mt-2 text-ink-soft">Войдите в аккаунт, чтобы видеть свои заказы.</p>
          <Link href="/login?next=%2Forders" className="btn btn-primary mt-4 inline-flex">Войти</Link>
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold">Не удалось загрузить заказы</h1>
          <button className="btn btn-primary mt-4" onClick={load}>Повторить</button>
        </div>
      </div>
    );
  }
  if (state.orders.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold">Заказов пока нет</h1>
          <Link href="/catalog" className="btn btn-primary mt-4 inline-flex">В каталог</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">Мои заказы</h1>
      <ul className="space-y-3">
        {state.orders.map((o) => (
          <li key={o.id} className="card p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <Link href={`/orders/${o.id}`} className="font-mono text-sm font-bold hover:underline">{o.number}</Link>
                <div className="text-xs text-ink-soft">{o.seller.name} · {timeAgo(o.createdAt)}</div>
              </div>
              <div>
                <span className="chip mr-2">{orderStatusLabel(o.status)}</span>
                <b className="text-svetlana-700">{rub(o.totalKopecks)}</b>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-3">
              <div>
                Оплата:{" "}
                {o.payment
                  ? o.payment.sandbox
                    ? <span className="text-amber-700">тестовая, деньги не списываются</span>
                    : paymentStatusLabel(o.payment.status)
                  : "ещё не оплачен"}
              </div>
              <div>Доставка: {o.shipment ? `${o.shipment.carrier} · ${shipmentStatusLabel(o.shipment.status)}` : "не создана"}</div>
              <div>Товаров: {o.itemsCount}</div>
            </div>
            <Link href={`/orders/${o.id}`} className="btn btn-ghost mt-3 px-3 py-1.5 text-xs">Подробнее</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
