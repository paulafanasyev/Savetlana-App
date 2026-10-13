"use client";

import { useState } from "react";

export function BecomeSellerButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/seller/become", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не получилось открыть кабинет");
      location.assign("/seller");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось открыть кабинет");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-primary" onClick={() => void open()} disabled={busy}>
        {busy ? "Открываем…" : "Открыть кабинет продавца"}
      </button>
      {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">{error}</div>}
    </div>
  );
}
