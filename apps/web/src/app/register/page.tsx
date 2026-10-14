"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useState } from "react";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "BUYER" });
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accepted) {
      setError("Чтобы создать аккаунт, примите условия и согласие на обработку данных.");
      return;
    }
    setBusy(true);
    setError(null);
    setExists(false);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, acceptTerms: true }),
      });
      // Если сервер ответил не JSON (таймаут хостинга), не показываем технический текст.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        if (data?.code === "exists") setExists(true);
        throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
      }
      // Администратор (почта из ADMIN_EMAILS) сразу попадает в админку.
      // Полная перезагрузка, чтобы шапка сайта сразу показала, что вход выполнен.
      const role = data?.user?.role;
      window.location.assign(role === "ADMIN" ? "/admin" : form.role === "SELLER" ? "/seller" : "/");
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Ошибка регистрации");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Регистрация</h1>
        <p className="mt-1 text-sm text-ink-soft">Покупайте и продавайте со Светланой.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="flex gap-2" role="radiogroup" aria-label="Кто вы">
            <button
              type="button"
              role="radio"
              aria-checked={form.role === "BUYER"}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                form.role === "BUYER" ? "border-svetlana-600 bg-svetlana-50 text-svetlana-700" : "border-surface-line bg-white text-ink-soft"
              }`}
              onClick={() => setForm({ ...form, role: "BUYER" })}
            >
              Я покупатель
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.role === "SELLER"}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                form.role === "SELLER" ? "border-svetlana-600 bg-svetlana-50 text-svetlana-700" : "border-surface-line bg-white text-ink-soft"
              }`}
              onClick={() => setForm({ ...form, role: "SELLER" })}
            >
              Я продавец
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Имя</span>
            <input
              className="input"
              required
              minLength={2}
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              className="input"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="register-password" className="text-sm font-medium text-ink">Пароль</label>
              <button type="button" className="text-xs font-medium text-svetlana-700 hover:underline" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "Скрыть" : "Показать"}
              </button>
            </div>
            <input
              id="register-password"
              type={showPassword ? "text" : "password"}
              className="input"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <span className="mt-1 block text-xs text-ink-faint">Не короче 8 символов</span>
          </div>
          <div className="flex items-start gap-2 text-sm text-ink-soft">
            <input id="register-accept" type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <label htmlFor="register-accept">
              Принимаю{" "}
              <Link href="/legal/offer" target="_blank" className="font-medium text-svetlana-700 hover:underline">условия пользования</Link>{" "}
              и даю{" "}
              <Link href="/privacy" target="_blank" className="font-medium text-svetlana-700 hover:underline">согласие на обработку персональных данных</Link>
            </label>
          </div>
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">
              {error}
              {exists && (
                <div className="mt-2 flex gap-3">
                  <Link href="/login" className="font-medium text-svetlana-700 hover:underline">Войти</Link>
                  <Link href={`/password-reset?email=${encodeURIComponent(form.email)}`} className="font-medium text-svetlana-700 hover:underline">Забыли пароль?</Link>
                </div>
              )}
            </div>
          )}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Создаём…" : "Создать аккаунт"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-ink-soft">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="font-medium text-svetlana-700 hover:underline">
            Войти
          </Link>
        </div>
      </div>
    </div>
  );
}
