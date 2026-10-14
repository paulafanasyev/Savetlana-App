"use client";

import { useState } from "react";

/** Отметка выплаты: оплачена по платёжке или банк её вернул. */
export function RegistryActions({ payoutId }: { payoutId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState("");
  const [reason, setReason] = useState("");
  const [showReturn, setShowReturn] = useState(false);

  async function send(path: string, body: Record<string, string>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/payouts/${payoutId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Не удалось сохранить");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Номер платёжки
          <input className="input mt-1 w-40" value={doc} maxLength={40} onChange={(e) => setDoc(e.target.value)} />
        </label>
        <button className="btn btn-primary" disabled={busy || doc.trim().length === 0} onClick={() => send("paid", { documentNumber: doc.trim() }, `Выплата оплачена платёжным поручением № ${doc.trim()}?`)}>Оплачено</button>
        {!showReturn && <button className="btn btn-ghost" disabled={busy} onClick={() => setShowReturn(true)}>Банк вернул</button>}
      </div>
      {showReturn && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Причина возврата
            <input className="input mt-1 w-72" value={reason} maxLength={300} placeholder="Например, неверный счёт" onChange={(e) => setReason(e.target.value)} />
          </label>
          <button className="btn btn-ghost" disabled={busy} onClick={() => send("returned", { reason: reason.trim() }, "Отметить возврат? Деньги снова станут доступны продавцу к выплате.")}>Отметить возврат</button>
        </div>
      )}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  );
}
