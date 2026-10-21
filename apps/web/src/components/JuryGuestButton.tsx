"use client";

import { useEffect, useState } from "react";

/**
 * Кнопки «Войти гостем для жюри» (покупатель) и «Войти продавцом для жюри»
 * (временный демо-магазин с входящим КП). Показываются, только если такой вход
 * включён на сервере.
 */
export function JuryGuestButton({ next }: { next: string }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<null | "buyer" | "seller">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/jury-guest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(Boolean(d?.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  const enter = async (kind: "buyer" | "seller") => {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(kind === "buyer" ? "/api/auth/jury-guest" : "/api/auth/jury-seller", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
      window.location.assign(kind === "buyer" ? next : "/seller/quotes");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 border-t border-surface-line pt-5" data-testid="jury-guest">
      <button type="button" className="btn btn-secondary w-full" disabled={busy !== null} onClick={() => enter("buyer")}>
        {busy === "buyer" ? "Входим…" : "Войти гостем для жюри"}
      </button>
      <button type="button" className="btn btn-ghost mt-2 w-full" disabled={busy !== null} onClick={() => enter("seller")}>
        {busy === "seller" ? "Открываем магазин…" : "Войти продавцом для жюри"}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        Без почты и пароля: создадим временный аккаунт на 3 дня, оплата в тестовом режиме. Продавцу достанется
        демо-магазин с входящим коммерческим предложением. Нажимая, вы принимаете{" "}
        <a href="/legal/offer" target="_blank" className="underline">условия</a> и{" "}
        <a href="/privacy" target="_blank" className="underline">политику конфиденциальности</a>.
      </p>
      {error && <div className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</div>}
    </div>
  );
}
