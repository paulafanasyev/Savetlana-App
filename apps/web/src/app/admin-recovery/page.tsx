"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/**
 * Аварийный вход администратора: если письмо со сбросом пароля не приходит.
 * Нужен секрет ADMIN_RECOVERY_TOKEN, который владелец сайта задал в настройках сервера.
 */
export default function AdminRecoveryPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/admin-recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, token, password }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Не удалось восстановить доступ");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось восстановить доступ");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card space-y-3 p-6">
          <h1 className="text-xl font-bold text-ink">Пароль изменён</h1>
          <p className="text-sm text-ink-soft">Войдите с новым паролем. Затем удалите ADMIN_RECOVERY_TOKEN из настроек сервера.</p>
          <Link href="/login?next=%2Fadmin" className="btn btn-primary inline-flex">Войти</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <form className="card space-y-4 p-6" onSubmit={submit}>
        <h1 className="text-xl font-bold text-ink">Восстановление доступа администратора</h1>
        <p className="text-sm text-ink-soft">Для владельца сайта, если письмо со сбросом пароля не пришло. Секрет задаётся в настройках сервера (ADMIN_RECOVERY_TOKEN).</p>
        <label className="block text-sm">Почта администратора
          <input className="input mt-1 w-full" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">Секрет восстановления
          <input className="input mt-1 w-full" type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label className="block text-sm">Новый пароль (не короче 8 символов)
          <input className="input mt-1 w-full" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Проверяем…" : "Сменить пароль"}</button>
      </form>
    </div>
  );
}
