"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Кнопка «Проверить в ФНС»: повторная проверка статуса самозанятого. */
export function NpdCheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/seller/npd-check", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось проверить");
      if (data.status === "VERIFIED") setResult({ ok: true, text: "ФНС подтвердила статус самозанятого." });
      else if (data.status === "REJECTED") setResult({ ok: false, text: `ФНС: ${data.message ?? "статус не подтверждён"}.` });
      else setResult({ ok: false, text: `Сейчас проверить не получилось: ${data.message ?? "сервис ФНС недоступен"}.` });
      router.refresh();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Не удалось проверить" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <button type="button" onClick={check} disabled={busy} className="btn btn-secondary px-4 py-2 text-sm disabled:opacity-50">
        {busy ? "Проверяем в ФНС…" : "Проверить в ФНС"}
      </button>
      {result && <p className={`mt-2 text-sm ${result.ok ? "text-green-700" : "text-amber-900"}`}>{result.text}</p>}
    </div>
  );
}
