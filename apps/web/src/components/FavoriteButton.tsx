"use client";

import { useState } from "react";

interface Props {
  productId: string;
  initialFavorite?: boolean;
}

/**
 * Adds the product to the flat favorites list. Optimistic UI, but the state is
 * set from the real API response only (spec §47). A guest is sent to login
 * and comes back to the same page afterwards.
 */
export function FavoriteButton({ productId, initialFavorite = false }: Props) {
  const [favorite, setFavorite] = useState(initialFavorite);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const previous = favorite;
    setFavorite(!previous);
    try {
      const res = await fetch("/api/favorites", {
        method: previous ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: previous ? null : JSON.stringify({ productId }),
      });
      if (res.status === 401) {
        setFavorite(previous);
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!res.ok) {
        setFavorite(previous);
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Не удалось изменить избранное");
      }
    } catch {
      setFavorite(previous);
      setError("Нет соединения. Попробуйте позже.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={favorite}
        className="inline-flex items-center justify-center rounded-lg border border-svetlana-200 px-4 py-2.5 text-sm font-medium text-svetlana-700 transition hover:bg-svetlana-50 disabled:opacity-50"
      >
        {favorite ? "★ В избранном" : "☆ В избранное"}
      </button>
      {error && <span className="mt-1 text-xs text-bad" role="alert">{error}</span>}
    </span>
  );
}
