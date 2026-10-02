"use client";

import { useState } from "react";

/**
 * Manual fulfillment controls for the seller (spec §112).
 *
 * The seller can run the whole order flow by hand — confirming a paid order and
 * handing it to a carrier do not require the AI. Each action calls the backend
 * and only reports success after the backend confirms it (spec §47).
 *
 * Shipping REQUIRES a carrier choice and, for carriers the platform cannot call
 * itself, the seller's own tracking number. Previously the button sent an empty
 * body and the route rejected it with `carrier_required`, so the seller could
 * not ship at all from the UI.
 */

/** Carriers the platform can talk to directly (others are accepted by name). */
const BUILTIN_CARRIERS = [
  { key: "cdek", label: "СДЭК", note: "платформа создаёт отправление сама" },
  { key: "sandbox-carrier", label: "Песочница (для тестов)", note: "sandbox — данные не настоящие" },
  { key: "SELLER_OWN_DELIVERY", label: "Своя доставка продавца", note: "продавец везёт сам" },
];

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
  const [showShip, setShowShip] = useState(false);
  const [carrier, setCarrier] = useState("cdek");
  const [customCarrier, setCustomCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [price, setPrice] = useState("");

  if (status === "CANCELLED" || status === "REFUNDED" || status === "COMPLETED") {
    return null;
  }

  async function call(endpoint: string, label: string, body?: unknown) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNoteKind("err");
        setNote(payload?.error ?? `${label} не удалось выполнить`);
      } else {
        setNoteKind("ok");
        // Report the carrier's own tracking number when one was issued, so the
        // seller can pass it on — never a placeholder we invented (spec §49).
        setNote(
          payload?.trackingNumber
            ? `✓ ${label}. Трек-номер: ${payload.trackingNumber}${
                payload.sandbox ? " (sandbox)" : ""
              }`
            : `✓ ${label}`,
        );
        setShowShip(false);
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

  const effectiveCarrier = carrier === "__custom__" ? customCarrier.trim() : carrier;
  // CDEK is only callable when credentials exist; everything else needs the
  // seller's own tracking number because the platform cannot poll it.
  const needsTrackingNumber =
    carrier !== "sandbox-carrier" && carrier !== "SELLER_OWN_DELIVERY";

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap gap-2">
        {canConfirm && (
          <button
            className="btn btn-primary px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => call(`/api/seller/orders/${orderId}/confirm`, "Подтверждение заказа")}
          >
            {busy ? "Выполняется…" : "Подтвердить заказ"}
          </button>
        )}
        {canShip && !showShip && (
          <button
            className="btn btn-ghost px-3 py-1.5 text-xs"
            disabled={busy || hasShipment}
            onClick={() => (hasShipment ? undefined : setShowShip(true))}
          >
            {hasShipment ? "Отправление создано" : busy ? "Выполняется…" : "Передать в доставку"}
          </button>
        )}
        {canShip && showShip && !hasShipment && (
          <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setShowShip(false)}>
            Отмена
          </button>
        )}
      </div>

      {canShip && showShip && !hasShipment && (
        <div className="mt-3 grid gap-2 rounded-lg border border-line bg-surface-2 p-3 text-xs">
          <label className="grid gap-1">
            <span className="font-medium text-ink-2">Перевозчик</span>
            <select
              className="input"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            >
              {BUILTIN_CARRIERS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} — {c.note}
                </option>
              ))}
              <option value="__custom__">Другой перевозчик (своим трек-номером)</option>
            </select>
          </label>

          {carrier === "__custom__" && (
            <label className="grid gap-1">
              <span className="font-medium text-ink-2">Название перевозчика</span>
              <input
                className="input"
                value={customCarrier}
                placeholder="Например, Boxberry"
                onChange={(e) => setCustomCarrier(e.target.value)}
              />
            </label>
          )}

          {needsTrackingNumber && (
            <label className="grid gap-1">
              <span className="font-medium text-ink-2">
                Трек-номер перевозчика{" "}
                <span className="font-normal text-ink-3">
                  (если СДЭК настроен, платформа создаст отправление сама — поле можно оставить пустым)
                </span>
              </span>
              <input
                className="input"
                value={trackingNumber}
                placeholder="Номер отправления"
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </label>
          )}

          <label className="grid gap-1">
            <span className="font-medium text-ink-2">Стоимость доставки, ₽ (необязательно)</span>
            <input
              className="input"
              value={price}
              inputMode="numeric"
              placeholder="350"
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>

          <button
            className="btn btn-primary justify-self-start px-3 py-1.5 text-xs"
            disabled={busy || !effectiveCarrier}
            onClick={() =>
              call(`/api/seller/orders/${orderId}/ship`, "Передача в доставку", {
                carrier: effectiveCarrier,
                trackingNumber: trackingNumber.trim() || undefined,
                deliveryKopecks: price ? Number(price) * 100 : undefined,
              })
            }
          >
            {busy ? "Создаём отправление…" : "Создать отправление"}
          </button>
        </div>
      )}

      {note && (
        <p className={`mt-2 text-xs ${noteKind === "ok" ? "text-good" : "text-bad"}`}>{note}</p>
      )}
    </div>
  );
}