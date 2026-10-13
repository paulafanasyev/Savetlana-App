"use client";

import { useState } from "react";

export function WishlistRemoveButton({ productId, listId }: { productId: string; listId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/wishlists?productId=${encodeURIComponent(productId)}&listId=${encodeURIComponent(listId)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Не удалось убрать из списка");
        return;
      }
      window.location.reload();
    } catch {
      setError("Нет соединения. Попробуйте позже.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={remove} disabled={pending} className="inline-flex items-center justify-center rounded-lg border border-surface-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-surface-muted disabled:opacity-50">Убрать из списка</button>
      {error && <span className="mt-1 text-xs text-bad" role="alert">{error}</span>}
    </span>
  );
}
