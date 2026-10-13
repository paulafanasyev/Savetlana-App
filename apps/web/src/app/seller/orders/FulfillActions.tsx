"use client";

import { useState } from "react";

// Здесь продавец сам отмечает получение: автоматического отслеживания нет.
const SELF_CONFIRMED_KEYS = ["SELLER_OWN_DELIVERY", "PICKUP", "seller_own", "pickup", "SELLER_DECLARED"];
const DELIVERABLE = ["CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT"];
const REJECT_REASONS: [string, string][] = [
  ["OUT_OF_STOCK", "Товар закончился"],
  ["CANNOT_DELIVER", "Не могу доставить"],
  ["LISTING_ERROR", "Ошибка в цене или описании"],
  ["OTHER", "Другая причина"],
];

export function FulfillActions({ orderId, status, hasShipment, shipmentProvider, allowTestCarrier = false, cdekConnected = false }: { orderId: string; status: string; hasShipment: boolean; shipmentProvider?: string | null; allowTestCarrier?: boolean; cdekConnected?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showShip, setShowShip] = useState(false);
  const [carrier, setCarrier] = useState("cdek");
  const [tracking, setTracking] = useState("");
  const [pointCode, setPointCode] = useState("");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("OUT_OF_STOCK");
  const [showDecline, setShowDecline] = useState(false);
  const [comment, setComment] = useState("");
  if (["CANCELLED", "REFUNDED", "COMPLETED", "DELIVERED"].includes(status)) return null;

  // Продавец либо сдаёт посылку сам и вводит трек-номер, либо (если СДЭК
  // подключён к площадке) оформляет отправку здесь: заявка уходит в СДЭК, а
  // статусы приходят сами. Тестовый перевозчик только вне боевого сайта.
  const carriers = [
    ...(cdekConnected ? [{ key: "cdek-api", label: "Оформить СДЭК здесь: сдам в пункт, курьер привезёт покупателю" }] : []),
    { key: "cdek", label: "Сдал посылку сам (СДЭК, Почта и т. п.)" },
    ...(allowTestCarrier ? [{ key: "sandbox-carrier", label: "Тестовый перевозчик" }] : []),
  ];
  const viaCdek = carrier === "cdek-api";
  const needsTracking = carrier !== "sandbox-carrier" && !viaCdek;
  const trackingMissing = needsTracking && tracking.trim().length === 0;
  const pointMissing = viaCdek && pointCode.trim().length < 3;
  const shipBody = viaCdek
    ? { carrier: "cdek", fromPointCode: pointCode.trim(), weightGrams: Number(weight) > 0 ? Number(weight) : undefined }
    : { carrier, trackingNumber: tracking.trim() || undefined };

  async function call(url: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
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

  const action = (name: string, extra?: Record<string, unknown>, confirmText?: string) =>
    call(`/api/seller/orders/${orderId}/action`, { action: name, ...extra }, confirmText);

  const canConfirm = status === "PAID";
  const canShip = ["CONFIRMED", "PROCESSING", "READY"].includes(status) && !hasShipment;
  const declared = shipmentProvider === "SELLER_DECLARED";
  const canDeliver = DELIVERABLE.includes(status) && (!hasShipment || SELF_CONFIRMED_KEYS.includes(shipmentProvider ?? ""));
  const commentShort = comment.trim().length < 10;

  return (
    <div className="space-y-3">
      {canConfirm && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => call(`/api/seller/orders/${orderId}/confirm`)}>Подтвердить заказ</button>
          {!showReject && <button className="btn btn-ghost" disabled={busy} onClick={() => setShowReject(true)}>Не могу выполнить</button>}
        </div>
      )}
      {canConfirm && showReject && (
        <div className="rounded border border-red-200 p-3">
          <p className="text-sm text-ink-soft">Заказ отменится, а деньги автоматически вернутся покупателю. Частые отказы снижают доверие к магазину.</p>
          <label className="mt-2 block text-sm">Причина
            <select className="input mt-1 w-full" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
              {REJECT_REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="mt-2 block text-sm">Сообщение покупателю{rejectReason === "OTHER" ? "" : " (необязательно)"}
            <input className="input mt-1 w-full" value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={busy || (rejectReason === "OTHER" && commentShort)} onClick={() => action("reject", { reason: rejectReason, comment }, "Отменить заказ и вернуть деньги покупателю?")}>Отменить заказ и вернуть деньги</button>
            <button className="btn btn-ghost" onClick={() => setShowReject(false)}>Назад</button>
          </div>
        </div>
      )}
      {status === "RETURN_REQUESTED" && (
        <div className="rounded border border-amber-200 p-3">
          <p className="text-sm text-ink-soft">Покупатель просит вернуть товар. Примите возврат, и покупатель отправит товар обратно. Деньги вернутся, когда вы отметите, что товар пришёл.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => action("accept_return")}>Принять возврат</button>
            {!showDecline && <button className="btn btn-ghost" disabled={busy} onClick={() => setShowDecline(true)}>Отказать</button>}
          </div>
          {showDecline && (
            <div className="mt-3">
              <label className="block text-sm">Почему возврат невозможен (покупатель увидит ответ и сможет открыть спор)
                <input className="input mt-1 w-full" value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
              </label>
              <button className="btn btn-ghost mt-2" disabled={busy || commentShort} onClick={() => action("decline_return", { comment }, "Отказать покупателю в возврате?")}>Отказать в возврате</button>
            </div>
          )}
        </div>
      )}
      {status === "RETURNING" && (
        <div className="rounded border border-svetlana-200 p-3">
          <p className="text-sm text-ink-soft">Покупатель отправляет товар обратно. Когда посылка придёт и вы её проверите, нажмите кнопку: деньги вернутся покупателю автоматически.</p>
          <button className="btn btn-primary mt-2" disabled={busy} onClick={() => action("refund_return", undefined, "Товар пришёл? Деньги будут возвращены покупателю.")}>Товар вернулся, вернуть деньги</button>
        </div>
      )}
      {canShip && !showShip && <button className="btn btn-ghost" disabled={busy} onClick={() => setShowShip(true)}>Отправил посылкой</button>}
      {canShip && showShip && (
        <div className="rounded border p-3">
          <label className="block text-sm">Как отправили
            <select className="input mt-1 w-full" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {carriers.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          {viaCdek ? (
            <>
              <label className="mt-2 block text-sm">Код пункта СДЭК, куда сдадите посылку
                <input className="input mt-1 w-full" value={pointCode} maxLength={20} placeholder="Например, MSK123" onChange={(e) => setPointCode(e.target.value.toUpperCase())} />
              </label>
              <label className="mt-2 block text-sm">Вес посылки, г (необязательно)
                <input className="input mt-1 w-full" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value.replace(/\D/g, ""))} />
              </label>
              <p className="mt-1 text-xs text-ink-soft">Код пункта есть на сайте СДЭК и на вывеске пункта. Заявка уйдёт в СДЭК, номер отправления и статусы покупатель увидит в заказе. Доставка уже оплачена покупателем.</p>
            </>
          ) : (
            <>
              <label className="mt-2 block text-sm">Трек-номер посылки{needsTracking ? "" : " (необязательно)"}
                <input className="input mt-1 w-full" value={tracking} onChange={(e) => setTracking(e.target.value)} />
              </label>
              {needsTracking && <p className="mt-1 text-xs text-ink-soft">Покупатель увидит трек-номер в заказе. Когда посылку вручат, отметьте получение ниже.</p>}
            </>
          )}
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={busy || trackingMissing || pointMissing} onClick={() => call(`/api/seller/orders/${orderId}/ship`, shipBody)}>{viaCdek ? "Оформить отправку" : "Сохранить отправку"}</button>
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
