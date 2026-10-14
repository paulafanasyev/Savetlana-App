"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Окно согласия поверх сайта для тех, кто уже вошёл, но ещё не принимал текущую
 * версию условий. Показывается сервером (ConsentGateServer), закрыть без ответа нельзя.
 */
export function ConsentGate() {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (!accepted) {
      setError("Отметьте галочку, чтобы продолжить.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptTerms: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="consent-gate-title">
      <div className="card w-full max-w-md p-8">
        <h2 id="consent-gate-title" className="text-xl font-bold text-ink">Подтвердите согласие</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Чтобы продолжить пользоваться аккаунтом, примите условия и дайте согласие на обработку
          персональных данных. Это нужно сделать один раз.
        </p>
        <div className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
          <input id="consent-gate-accept" type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <label htmlFor="consent-gate-accept">
            Принимаю{" "}
            <Link href="/legal/offer" target="_blank" className="font-medium text-svetlana-700 hover:underline">условия пользования</Link>{" "}
            и даю{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-svetlana-700 hover:underline">согласие на обработку персональных данных</Link>
          </label>
        </div>
        {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</div>}
        <button className="btn btn-primary mt-6 w-full" disabled={busy} onClick={accept}>
          {busy ? "Сохраняем…" : "Продолжить"}
        </button>
        <button className="btn btn-secondary mt-3 w-full" disabled={busy} onClick={decline}>
          Не сейчас, выйти
        </button>
      </div>
    </div>
  );
}
