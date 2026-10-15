"use client";

import { useState, type FormEvent } from "react";

/** Смена пароля в профиле: текущий пароль, новый и его повтор. */
export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!open) {
    return (
      <span className="flex flex-col items-end gap-1">
        <button type="button" className="text-xs font-medium text-svetlana-700 hover:underline" onClick={() => { setOpen(true); setDone(null); }}>
          Сменить
        </button>
        {done && <span className="text-xs text-green-700">{done}</span>}
      </span>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("Новый пароль должен быть не короче 8 символов.");
    if (next !== repeat) return setError("Новый пароль и повтор не совпадают.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось сменить пароль");
      setDone(data.message ?? "Пароль изменён.");
      setCurrent("");
      setNext("");
      setRepeat("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-surface-line px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} className="mt-3 w-full space-y-2">
      <input type="password" autoComplete="current-password" placeholder="Текущий пароль" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} required />
      <input type="password" autoComplete="new-password" placeholder="Новый пароль, от 8 символов" value={next} onChange={(e) => setNext(e.target.value)} className={field} required minLength={8} />
      <input type="password" autoComplete="new-password" placeholder="Повторите новый пароль" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field} required />
      {error && <p className="text-xs text-bad">{error}</p>}
      <p className="text-xs text-ink-soft">На других устройствах придётся войти заново. На почту придёт письмо о смене пароля.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">
          {busy ? "Сохраняем…" : "Сменить пароль"}
        </button>
        <button type="button" className="btn btn-secondary px-4 py-2 text-sm" onClick={() => { setOpen(false); setError(null); }}>
          Отмена
        </button>
      </div>
    </form>
  );
}
