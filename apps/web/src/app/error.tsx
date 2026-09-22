"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary (App Router). Replaces the synthesised
 * pages-router _error page that cannot be prerendered in this environment.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Structured logging without sensitive payload content (spec §51).
    console.error("route error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="text-5xl">⚠️</div>
      <h1 className="mt-4 text-2xl font-bold text-ink">Что-то пошло не так</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Не удалось получить данные. Попробуйте повторить запрос.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button className="btn btn-primary" onClick={() => reset()}>
          Повторить
        </button>
        <Link href="/" className="btn btn-ghost">
          На главную
        </Link>
      </div>
    </div>
  );
}
