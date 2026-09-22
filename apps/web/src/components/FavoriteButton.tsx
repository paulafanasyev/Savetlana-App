"use client";

import { useState } from "react";

interface Props {
  productId: string;
  initialFavorite?: boolean;
}

/**
 * Adds the product to the flat favorites list. Optimistic UI, but the state is
 * set from the real API response only — the button never claims success before
 * the backend confirms it (spec §47).
 */
export function FavoriteButton({ productId, initialFavorite = false }: Props) {
  const [favorite, setFavorite] = useState(initialFavorite);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const previous = favorite;
    setFavorite(!previous);
    try {
      const res = await fetch("/api/favorites", {
        method: previous ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: previous ? null : JSON.stringify({ productId }),
      });
      if (!res.ok) {
        setFavorite(previous);
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Не удалось изменить избранное");
      }
    } catch {
      setFavorite(previous);
      alert("Нет соединения. Попробуйте позже.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorite}
      className="inline-flex items-center justify-center rounded-lg border border-svetlana-200 px-4 py-2.5 text-sm font-medium text-svetlana-700 transition hover:bg-svetlana-50 disabled:opacity-50"
    >
      {favorite ? "★ В избранном" : "☆ В избранное"}
    </button>
  );
}
