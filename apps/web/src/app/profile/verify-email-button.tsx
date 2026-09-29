"use client";

import { useState } from "react";

/**
 * Requests an email verification ticket and reveals the dev-only link inline
 * when the backend permits it (never in production, where the link must reach
 * the user's inbox).
 */
export function VerifyEmailButton() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const request = async () => {
    setBusy(true);
    setNote(null);
    setLink(null);
    try {
      const res = await fetch("/api/auth/verify-email/request", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось отправить письмо");
      setNote("Ссылка отправлена. Проверьте почту (30 минут).");
      if (typeof data.devTicket === "string" && data.devTicket) {
        setLink(`/verify-email?ticket=${encodeURIComponent(data.devTicket)}`);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Не удалось отправить письмо");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
          Не подтверждён
        </span>
        <button
          type="button"
          className="text-xs font-medium text-svetlana-700 hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={request}
        >
          {busy ? "Отправляем…" : "Подтвердить"}
        </button>
      </span>
      {note && <span className="text-xs text-ink-soft">{note}</span>}
      {link && (
        <a href={link} className="text-xs font-medium text-svetlana-700 hover:underline">
          Перейти по ссылке (режим разработки)
        </a>
      )}
    </span>
  );
}
