"use client";

import { useEffect, useState } from "react";

interface Props { productId: string; initialFavorite?: boolean; reloadOnChange?: boolean }

export function FavoriteButton({ productId, initialFavorite, reloadOnChange = false }: Props) {
  const [favorite, setFavorite] = useState(Boolean(initialFavorite));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialFavorite !== undefined) return;
    let cancelled = false;
    fetch("/api/favorites")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: { id: string }[] } | null) => {
        if (!cancelled && data?.items) setFavorite(data.items.some((item) => item.id === productId));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [initialFavorite, productId]);

  async function toggle() {
    setPending(true);
    setError(null);
    const previous = favorite;
    setFavorite(!previous);
    try {
      const res = previous
        ? await fetch(`/api/favorites?productId=${encodeURIComponent(productId)}`, { method: "DELETE" })
        : await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }) });
      if (res.status === 401) {
        setFavorite(previous);
        const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!res.ok) {
        setFavorite(previous);
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Не удалось изменить избранное");
        return;
      }
      if (reloadOnChange) window.location.reload();
    } catch {
      setFavorite(previous);
      setError("Нет соединения. Попробуйте позже.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={toggle} disabled={pending} aria-pressed={favorite} className="inline-flex items-center justify-center rounded-lg border border-svetlana-200 px-4 py-2.5 text-sm font-medium text-svetlana-700 transition hover:bg-svetlana-50 disabled:opacity-50">{favorite ? "★ В избранном" : "☆ В избранное"}</button>
      {error && <span className="mt-1 text-xs text-bad" role="alert">{error}</span>}
    </span>
  );
}
