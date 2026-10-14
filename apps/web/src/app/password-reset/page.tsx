"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Password recovery request page (audit §15).
 * The endpoint never reveals whether an account exists, so the UI shows the
 * same confirmation either way. Если на сайте не настроена почта, честно
 * говорим об этом вместо «Проверьте почту».
 */
function ResetRequestInner() {
  const router = useRouter();
  const params = useSearchParams();
  const prefilled = params?.get("email") ?? "";
  const [email, setEmail] = useState(prefilled);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось отправить ссылку");
      setEmailEnabled(data.emailEnabled !== false);
      setDone(true);
      // Dev-only convenience: the backend surfaces the link inline only outside
      // production, so a local tester can follow it without a mailer.
      if (typeof data.devTicket === "string" && data.devTicket) {
        setDevLink(data.devTicket);
      }
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Не удалось отправить ссылку");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-8">
          {emailEnabled ? (
            <>
              <h1 className="text-2xl font-bold text-ink">Проверьте почту</h1>
              <p className="mt-2 text-sm text-ink-soft">
                Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля.
                Ссылка действует 30 минут. Не видите письма? Загляните в «Спам».
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-ink">Письма пока не отправляются</h1>
              <p className="mt-2 text-sm text-ink-soft">
                На сайте ещё не настроена отправка почты, поэтому письмо со ссылкой не придёт.
                Напишите нам, и мы поможем восстановить доступ.
              </p>
              <Link href="/contacts" className="btn btn-primary mt-4 inline-flex">
                Написать в поддержку
              </Link>
            </>
          )}
          {devLink && (
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-ink">
              <div className="font-medium">Режим разработки</div>
              <div className="mt-1 break-all">
                <a href={devLink} className="font-medium text-svetlana-700 hover:underline">
                  Перейти по ссылке сброса
                </a>
              </div>
            </div>
          )}
          <button
            className="btn btn-secondary mt-6 w-full"
            onClick={() => router.push("/login")}
          >
            Вернуться ко входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink">Восстановление пароля</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Укажите email, и мы пришлём ссылку для установки нового пароля.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              className="input"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">{error}</div>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Отправляем…" : "Отправить ссылку"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PasswordResetRequestPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-ink-soft">Загрузка…</div>}>
      <ResetRequestInner />
    </Suspense>
  );
}
