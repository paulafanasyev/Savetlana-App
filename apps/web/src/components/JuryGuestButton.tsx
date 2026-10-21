"use client";

import { useEffect, useState } from "react";

/**
 * Кнопка «Войти гостем для жюри» на странице входа. Показывается, только если такой
 * вход включён на сервере. После входа ведёт туда, куда человек шёл.
 */
export function JuryGuestButton({ next }: { next: string }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/jury-guest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(Boolean(d?.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  const enter = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/jury-guest", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
      window.location.assign(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t border-surface-line pt-5" data-testid="jury-guest">
      <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={enter}>
        {busy ? "Входим…" : "Войти гостем для жюри"}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        Без почты и пароля: создадим временный аккаунт покупателя на 3 дня, оплата в тестовом режиме.
        Нажимая, вы принимаете{" "}
        <a href="/legal/offer" target="_blank" className="underline">условия</a> и{" "}
        <a href="/privacy" target="_blank" className="underline">политику конфиденциальности</a>.
      </p>
      {error && <div className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</div>}
    </div>
  );
}
