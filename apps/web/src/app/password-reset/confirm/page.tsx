"use client";

export const dynamic = "force-dynamic";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * New-password page (audit §15). Reached from the recovery link.
 * The ticket is consumed on submit; a replay of the same link is rejected.
 */
function ResetConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ticket = params?.get("ticket") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось изменить пароль");
      router.push("/login?reset=1");
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
            В ссылке отсутствует код подтверждения. Запросите новую ссылку для сброса пароля.
          </p>
          <a
            href="/password-reset"
            className="btn btn-primary mt-6 inline-block"
          >
            Запросить ссылку
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Новый пароль</h1>
        <p className="mt-1 text-sm text-ink-soft">
          После смены пароля все предыдущие сеансы будут завершены.
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
            <span className="mb-1 block text-sm font-medium text-ink">Повторите пароль</span>
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
            {busy ? "Сохраняем…" : "Сохранить пароль"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PasswordResetConfirmPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-ink-soft">Загрузка…</div>}>
      <ResetConfirmInner />
    </Suspense>
  );
}
