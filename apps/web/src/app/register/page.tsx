"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "BUYER" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка регистрации");
      // Администратор (почта из ADMIN_EMAILS) сразу попадает в админку.
      const role = data?.user?.role;
      router.push(role === "ADMIN" ? "/admin" : form.role === "SELLER" ? "/seller" : "/");
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Ошибка регистрации");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Регистрация</h1>
        <p className="mt-1 text-sm text-ink-soft">Покупайте и продавайте со Светланой.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                form.role === "BUYER" ? "border-svetlana-600 bg-svetlana-50 text-svetlana-700" : "border-surface-line bg-white text-ink-soft"
              }`}
              onClick={() => setForm({ ...form, role: "BUYER" })}
            >
              Я покупатель
            </button>
            <button
              type="button"
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
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Пароль</span>
            <input
              type="password"
              className="input"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <span className="mt-1 block text-xs text-ink-faint">Не короче 8 символов</span>
          </label>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">{error}</div>}
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
