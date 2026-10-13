"use client";

import { useState } from "react";

// Перевозчики. Самовывоз и своя доставка закрываются кнопкой «Покупатель получил заказ».
const CARRIERS = [
  { key: "cdek", label: "СДЭК" },
  { key: "sandbox-carrier", label: "Тестовый перевозчик" },
];
const OWN_DELIVERY_KEYS = ["SELLER_OWN_DELIVERY", "PICKUP", "seller_own", "pickup"];
const DELIVERABLE = ["CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT"];

export function FulfillActions({ orderId, status, hasShipment, shipmentProvider }: { orderId: string; status: string; hasShipment: boolean; shipmentProvider?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showShip, setShowShip] = useState(false);
  const [carrier, setCarrier] = useState("cdek");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  if (["CANCELLED", "REFUNDED", "COMPLETED", "DELIVERED"].includes(status)) return null;

  async function call(url: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Не удалось выполнить действие");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = status === "PAID";
  const canShip = ["CONFIRMED", "PROCESSING", "READY"].includes(status) && !hasShipment;
  const canDeliver = DELIVERABLE.includes(status) && (!hasShipment || OWN_DELIVERY_KEYS.includes(shipmentProvider ?? ""));

  return (
    <div className="space-y-3">
      {canConfirm && <button className="btn btn-primary" disabled={busy} onClick={() => call(`/api/seller/orders/${orderId}/confirm`)}>Подтвердить заказ</button>}
      {canShip && !showShip && <button className="btn btn-ghost" disabled={busy} onClick={() => setShowShip(true)}>Отправить перевозчиком</button>}
      {canShip && showShip && (
        <div className="rounded border p-3">
          <label className="block text-sm">Перевозчик
            <select className="input mt-1 w-full" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="mt-2 block text-sm">Номер отправления (если уже есть)
            <input className="input mt-1 w-full" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => call(`/api/seller/orders/${orderId}/ship`, { carrier, trackingNumber: tracking || undefined })}>Создать отправление</button>
            <button className="btn btn-ghost" onClick={() => setShowShip(false)}>Отмена</button>
          </div>
        </div>
      )}
      {canDeliver && (
        <div className="rounded border border-svetlana-200 p-3">
          <p className="text-sm text-ink-soft">Самовывоз или своя доставка: нажмите, когда покупатель забрал заказ.</p>
          <label className="mt-2 block text-sm">Примечание (необязательно)
            <input className="input mt-1 w-full" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="btn btn-primary mt-2" disabled={busy} onClick={() => call(`/api/seller/orders/${orderId}/delivered`, { note: note || undefined })}>Покупатель получил заказ</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
