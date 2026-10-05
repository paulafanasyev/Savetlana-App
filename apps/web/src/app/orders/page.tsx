"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

type LoadState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error" }
  | { kind: "ready"; orders: OrderRow[] };

const PAYMENT_LABELS: Record<string, string> = {
  SUCCEEDED: "оплачен",
  PENDING: "ожидает оплаты",
  PROCESSING: "обрабатывается",
  FAILED: "ошибка оплаты",
  REFUNDED: "возвращён",
};

function paymentLabel(status: string): string {
  return PAYMENT_LABELS[status] ?? status.toLowerCase();
}

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
        <h1 className="mb-4 text-2xl font-bold text-ink">Мои заказы</h1>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-24 animate-pulse bg-surface-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === "unauthenticated") {
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

  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card p-8 text-center" role="alert">
          <h1 className="text-xl font-bold text-ink">Не удалось загрузить заказы</h1>
          <p className="mt-2 text-ink-soft">Проверьте соединение и попробуйте ещё раз.</p>
          <button className="btn btn-primary mt-4 inline-flex" onClick={load}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const orders = state.orders;
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
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link href={`/orders/${o.id}`} className="font-mono text-sm font-bold text-ink hover:text-svetlana-700 hover:underline">
                  {o.number}
                </Link>
                <div className="text-xs text-ink-soft">
                  {o.seller.name} · {timeAgo(o.createdAt)}
                </div>
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
                    {paymentLabel(o.payment.status)}
                    {o.payment.sandbox ? " (тестовый платёж)" : ""}
                  </span>
                ) : (
                  "ещё не оплачен"
                )}
              </div>
              <div>Доставка: {o.shipment ? `${o.shipment.carrier} · ${orderStatusLabel(o.shipment.status)}` : "не создана"}</div>
              <div>Товаров: {o.itemsCount}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.status === "PAYMENT_PENDING" && (
                <Link href={`/orders/${o.id}`} className="btn btn-primary px-3 py-1.5 text-xs">
                  Оплатить
                </Link>
              )}
              {o.shipment && (
                <Link href={`/orders/${o.id}#tracking`} className="btn btn-ghost px-3 py-1.5 text-xs">
                  Отследить
                </Link>
              )}
              {["DELIVERED", "COMPLETED"].includes(o.status) && (
                <Link href={`/orders/${o.id}#return`} className="btn btn-ghost px-3 py-1.5 text-xs">
                  Возврат или спор
                </Link>
              )}
              <Link href={`/orders/${o.id}`} className="btn btn-ghost px-3 py-1.5 text-xs">
                Подробнее
              </Link>
              {canCancel(o.status) && <CancelButton orderId={o.id} onDone={load} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function canCancel(status: string): boolean {
  return ["CREATED", "PAYMENT_PENDING", "PAID", "CONFIRMED"].includes(status);
}

function CancelButton({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  return (
    <button
      className="btn btn-ghost px-3 py-1.5 text-xs text-bad"
      disabled={state === "busy" || state === "ok"}
      aria-live="polite"
      onClick={async () => {
        if (!confirm("Отменить этот заказ?")) return;
        setState("busy");
        const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" }).catch(() => null);
        if (res?.ok) {
          setState("ok");
          onDone();
        } else setState("err");
      }}
    >
      {state === "busy" && "Отменяем…"}
      {state === "idle" && "Отменить заказ"}
      {state === "ok" && "✓ Отменён"}
      {state === "err" && "Не удалось, повторить"}
    </button>
  );
}
