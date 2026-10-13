"use client";

import { useState } from "react";

// Здесь продавец сам отмечает получение: автоматического отслеживания нет.
const SELF_CONFIRMED_KEYS = ["SELLER_OWN_DELIVERY", "PICKUP", "seller_own", "pickup", "SELLER_DECLARED"];
const DELIVERABLE = ["CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT"];

export function FulfillActions({ orderId, status, hasShipment, shipmentProvider, allowTestCarrier = false }: { orderId: string; status: string; hasShipment: boolean; shipmentProvider?: string | null; allowTestCarrier?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showShip, setShowShip] = useState(false);
  const [carrier, setCarrier] = useState("cdek");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  if (["CANCELLED", "REFUNDED", "COMPLETED", "DELIVERED"].includes(status)) return null;

  // Подключённых служб доставки пока нет: продавец сдаёт посылку сам и вводит
  // трек-номер, а получение отмечает здесь же. Тестовый перевозчик только вне
  // боевого сайта (решает сервер; он же его и отклоняет).
  const carriers = [
    { key: "cdek", label: "Сдал посылку сам (СДЭК, Почта и т. п.)" },
    ...(allowTestCarrier ? [{ key: "sandbox-carrier", label: "Тестовый перевозчик" }] : []),
  ];
  const needsTracking = carrier !== "sandbox-carrier";
  const trackingMissing = needsTracking && tracking.trim().length === 0;

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
  const declared = shipmentProvider === "SELLER_DECLARED";
  const canDeliver = DELIVERABLE.includes(status) && (!hasShipment || SELF_CONFIRMED_KEYS.includes(shipmentProvider ?? ""));

  return (
    <div className="space-y-3">
      {canConfirm && <button className="btn btn-primary" disabled={busy} onClick={() => call(`/api/seller/orders/${orderId}/confirm`)}>Подтвердить заказ</button>}
      {canShip && !showShip && <button className="btn btn-ghost" disabled={busy} onClick={() => setShowShip(true)}>Отправил посылкой</button>}
      {canShip && showShip && (
        <div className="rounded border p-3">
          <label className="block text-sm">Как отправили
            <select className="input mt-1 w-full" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {carriers.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="mt-2 block text-sm">Трек-номер посылки{needsTracking ? "" : " (необязательно)"}
            <input className="input mt-1 w-full" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>
          {needsTracking && <p className="mt-1 text-xs text-ink-soft">Покупатель увидит трек-номер в заказе. Когда посылку вручат, отметьте получение ниже.</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={busy || trackingMissing} onClick={() => call(`/api/seller/orders/${orderId}/ship`, { carrier, trackingNumber: tracking.trim() || undefined })}>Сохранить отправку</button>
            <button className="btn btn-ghost" onClick={() => setShowShip(false)}>Отмена</button>
          </div>
        </div>
      )}
      {canDeliver && (
        <div className="rounded border border-svetlana-200 p-3">
          <p className="text-sm text-ink-soft">
            {declared
              ? "Посылка с вашим трек-номером не отслеживается автоматически: когда перевозчик вручит её, отметьте это здесь."
              : "Самовывоз или своя доставка: нажмите, когда покупатель забрал заказ."}
          </p>
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
