"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/** Куда вернуться после входа: только на страницу этого же сайта (защита от open redirect). */
function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

const NO_ANSWER = "Сервер не ответил. Попробуйте ещё раз через минуту.";

/** Шаг согласия для аккаунтов, которые ещё не принимали текущую версию условий. */
function ConsentStep({ target }: { target: string }) {
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
      if (!res.ok || !data) throw new Error(data?.error ?? NO_ANSWER);
      window.location.assign(target);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : NO_ANSWER);
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Один шаг до входа</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Чтобы пользоваться аккаунтом, подтвердите согласие с условиями и на обработку
          персональных данных. Это нужно сделать один раз.
        </p>
        <div className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
          <input id="login-accept" type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <label htmlFor="login-accept">
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

function LoginInner() {
  const params = useSearchParams();
  const next = safeNext(params?.get("next"));
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentTarget, setConsentTarget] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      // Если сервер ответил не JSON (таймаут хостинга), не показываем технический текст.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? NO_ANSWER);
      // Администратора без явного «куда» ведём сразу в админку.
      const target = next === "/" && data?.user?.role === "ADMIN" ? "/admin" : next;
      if (data.needsConsent) {
        setConsentTarget(target);
        setBusy(false);
        return;
      }
      // Полная перезагрузка, чтобы шапка сайта сразу показала, что вход выполнен.
      window.location.assign(target);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Ошибка входа");
      setBusy(false);
    }
  };

  if (consentTarget) return <ConsentStep target={consentTarget} />;

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Вход</h1>
        <p className="mt-1 text-sm text-ink-soft">Рады видеть вас снова.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              className="input"
              required
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="login-password" className="text-sm font-medium text-ink">Пароль</label>
              <button type="button" className="text-xs font-medium text-svetlana-700 hover:underline" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "Скрыть" : "Показать"}
              </button>
            </div>
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              className="input"
              required
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</div>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
        <div className="mt-3 text-right text-sm">
          <Link
            href={form.email ? `/password-reset?email=${encodeURIComponent(form.email)}` : "/password-reset"}
            className="font-medium text-svetlana-700 hover:underline"
          >
            Забыли пароль?
          </Link>
        </div>
        <div className="mt-4 text-center text-sm text-ink-soft">
          Нет аккаунта?{" "}
          <Link href="/register" className="font-medium text-svetlana-700 hover:underline">
            Зарегистрироваться
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-ink-soft">Загрузка…</div>}>
      <LoginInner />
    </Suspense>
  );
}
