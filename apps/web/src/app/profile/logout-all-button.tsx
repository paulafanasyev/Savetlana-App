"use client";

import { useState } from "react";

/**
 * Security actions for the profile (audit §15): ends every active session on
 * the account, including the one performing the request.
 */
export function LogoutAllButton() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!window.confirm("Завершить все активные сеансы на всех устройствах?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось завершить сеансы");
      setDone(true);
      // The current session is revoked too — return to login.
      window.location.href = "/login";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить сеансы");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <span className="text-xs text-ink-soft">Сеансы завершены…</span>;
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Завершаем…" : "Завершить сеансы"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
