"use client";

import { useState } from "react";

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** Покупатель: оформить заказ по подтверждённому КП. */
export function AcceptQuoteButton({ quoteId }: { quoteId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        className="rounded bg-blue-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setError("");
          const { ok, data } = await post("/api/quotes/accept", { quoteId }).catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
          if (ok && typeof data.orderId === "string") {
            window.location.href = `/orders/${data.orderId}`;
            return;
          }
          setError(typeof data.error === "string" ? data.error : "Не получилось, попробуйте ещё раз");
          setBusy(false);
        }}
      >
        {busy ? "Оформляю…" : "Оформить заказ по цене КП"}
      </button>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}

/** Продавец: подтвердить или отклонить КП. */
export function SellerQuoteButtons({ quoteId }: { quoteId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "confirm" | "decline") {
    setBusy(true);
    setError("");
    const { ok, data } = await post("/api/seller/quotes", { quoteId, decision }).catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
    if (ok) {
      window.location.reload();
      return;
    }
    setError(typeof data.error === "string" ? data.error : "Не получилось, попробуйте ещё раз");
    setBusy(false);
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button type="button" disabled={busy} className="rounded bg-blue-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" onClick={() => decide("confirm")}>
          Подтвердить КП
        </button>
        <button type="button" disabled={busy} className="rounded border px-4 py-2 text-sm disabled:opacity-60" onClick={() => decide("decline")}>
          Отклонить
        </button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}
