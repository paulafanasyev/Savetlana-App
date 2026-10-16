"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Исполнитель сдаёт работу: короткий отчёт, подтверждение, заказчику уходит уведомление. */
export function SubmitWorkForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-deals/${orderId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Не удалось сдать работу");
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
    <div className="mt-3 space-y-2">
      <label className="block text-xs">
        Что сделано
        <textarea
          className="input mt-1 min-h-[80px] w-full text-ink"
          maxLength={1000}
          placeholder="Коротко опишите результат: что готово и где заказчик может его проверить"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Сдать работу? Заказчик получит отчёт и 7 дней на проверку.</span>
          <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void submit()}>{busy ? "Сдаём…" : "Да, сдать"}</button>
          <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => setConfirming(false)}>Нет</button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setConfirming(true)}>Сдать работу</button>
      )}
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}
