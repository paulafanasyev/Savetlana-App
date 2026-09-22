"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Root error boundary — catches errors that route-level error.tsx cannot,
 * including the 500 path. Replaces the synthesised pages-router _error page
 * which cannot be prerendered without a pages/_document in this environment.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the digest only — never sensitive payload content (spec §51).
    console.error("global route error", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="ru">
      <body className="min-h-screen">
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <div className="text-5xl">⚠️</div>
          <h1 className="mt-4 text-2xl font-bold text-ink">Сервис временно недоступен</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Произошла ошибка на сервере. Мы уже знаем о ней — попробуйте повторить запрос.
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
      </body>
    </html>
  );
}
