"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Заказчик выбирает исполнителя: сначала подтверждение, потом запрос. */
export function ChooseBidButton({ classifiedId, applicantId, name }: { classifiedId: string; applicantId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/classifieds/${classifiedId}/bids/choose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicantId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Не удалось выбрать исполнителя");
        return;
      }
      router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-2 text-xs">
      {confirming ? (
        <div className="flex flex-wrap justify-end gap-2">
          <span className="w-full text-right text-ink-soft">Выбрать {name}? Остальным придёт уведомление.</span>
          <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void choose()}>{busy ? "Выбираем…" : "Да, выбрать"}</button>
          <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => setConfirming(false)}>Нет</button>
        </div>
      ) : (
        <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => setConfirming(true)}>Выбрать исполнителем</button>
      )}
      {error && <p className="mt-1 text-right text-bad" role="alert">{error}</p>}
    </div>
  );
}
