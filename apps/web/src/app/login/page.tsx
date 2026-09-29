"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get("next") ?? "/";
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка входа");
      router.push(next);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

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
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">{error}</div>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
        <div className="mt-3 text-right text-sm">
          <Link
            href="/password-reset"
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
