"use client";

export const dynamic = "force-dynamic";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Password recovery confirm page (audit §15).
 *
 * Reached from the reset link (`/reset-password?ticket=...`). The ticket is a
 * single-use secret: submitting consumes it and installs the new password,
 * after which every prior session is revoked.
 */
function ResetConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ticket = params?.get("ticket") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось изменить пароль");
      setDone(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Не удалось изменить пароль");
    } finally {
      setBusy(false);
    }
  };

  if (!ticket) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Ссылка недействительна</h1>
          <p className="mt-2 text-sm text-ink-soft">
            В ссылке для сброса отсутствует код. Запросите новую ссылку.
          </p>
          <button
            className="btn btn-secondary mt-6"
            onClick={() => router.push("/password-reset")}
          >
            Запросить ссылку
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Пароль изменён</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Все предыдущие сеансы завершены. Войдите с новым паролем.
          </p>
          <button
            className="btn btn-primary mt-6"
            onClick={() => router.push("/login")}
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Новый пароль</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Придумайте новый пароль. Ссылка одноразовая и действует 30 минут.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Новый пароль</span>
            <input
              type="password"
              className="input"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-soft">
              Повторите пароль
            </span>
            <input
              type="password"
              className="input"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">{error}</div>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Сохраняем…" : "Изменить пароль"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetConfirmPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-ink-soft">Загрузка…</div>}>
      <ResetConfirmInner />
    </Suspense>
  );
}
