"use client";

import { useState } from "react";

/**
 * Manual fulfillment controls for the seller (spec §112).
 *
 * The seller can run the whole order flow by hand — confirming a paid order and
 * handing it to a carrier do not require the AI. Each action calls the backend
 * and only reports success after the backend confirms it (spec §47).
 */
export function FulfillActions({
  orderId,
  status,
  hasShipment,
}: {
  orderId: string;
  status: string;
  hasShipment: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<"ok" | "err">("ok");

  if (status === "CANCELLED" || status === "REFUNDED" || status === "COMPLETED") {
    return null;
  }

  async function call(endpoint: string, label: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setNoteKind("err");
        setNote(body?.error ?? `${label} не удалось выполнить`);
      } else {
        setNoteKind("ok");
        setNote(`✓ ${label} выполнено`);
        // Reload to reflect the authoritative backend state.
        window.location.reload();
      }
    } catch {
      setNoteKind("err");
      setNote(`Не удалось связаться с сервером (${label})`);
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = status === "PAID";
  const canShip = status === "CONFIRMED" || status === "PROCESSING" || status === "READY";

  if (!canConfirm && !canShip) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
      {canConfirm && (
        <button
          className="btn btn-primary px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => call(`/api/seller/orders/${orderId}/confirm`, "Подтверждение заказа")}
        >
          {busy ? "Выполняется…" : "Подтвердить заказ"}
        </button>
      )}
      {canShip && (
        <button
          className="btn btn-ghost px-3 py-1.5 text-xs"
          disabled={busy || hasShipment}
          onClick={() => call(`/api/seller/orders/${orderId}/ship`, "Передача в доставку")}
        >
          {hasShipment ? "Отправление создано" : busy ? "Выполняется…" : "Передать в доставку"}
        </button>
      )}
      {note && (
        <p className={`self-center text-xs ${noteKind === "ok" ? "text-good" : "text-bad"}`}>{note}</p>
      )}
    </div>
  );
}
