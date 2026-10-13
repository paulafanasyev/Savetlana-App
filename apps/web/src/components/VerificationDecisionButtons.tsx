"use client";

import { useState } from "react";

export function VerificationDecisionButtons({ sellerId, kind = "business" }: { sellerId: string; kind?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(approved: boolean) {
    const note = approved ? undefined : window.prompt("Укажите причину отказа") ?? "";
    if (!approved && !note?.trim()) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/verification/${sellerId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, approved, note }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); setError(body.error ?? "Не удалось сохранить решение"); setBusy(false); return; }
    window.location.reload();
  }
  return <div className="space-y-2"><div className="flex gap-2"><button disabled={busy} onClick={() => void decide(true)} className="rounded bg-green-700 px-3 py-1 text-white">Одобрить</button><button disabled={busy} onClick={() => void decide(false)} className="rounded bg-red-700 px-3 py-1 text-white">Отклонить</button></div>{error && <p className="text-sm text-red-700">{error}</p>}</div>;
}
