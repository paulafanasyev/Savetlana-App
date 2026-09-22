"use client";

import { useState } from "react";

/**
 * Publishes an AI-prepared draft card. Publishing is a legally significant
 * action, so the seller must explicitly confirm it in the UI (spec §12, §147).
 */
export function PublishProductButton({ productId, title }: { productId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    const ok = window.confirm(
      `Опубликовать карточку «${title}»? Она станет видна покупателям.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seller/products/${productId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Не удалось опубликовать товар");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
      setBusy(false);
    }
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className="btn btn-primary text-xs"
      >
        {busy ? "Публикую…" : "Опубликовать"}
      </button>
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  );
}
