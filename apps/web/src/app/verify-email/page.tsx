"use client";

export const dynamic = "force-dynamic";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Email confirmation landing page (audit §15). The `ticket` param is consumed
 * once; an already-used or expired link is reported honestly.
 */
function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ticket = params?.get("ticket") ?? "";
  const [status, setStatus] = useState<"idle" | "verifying" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const verify = async () => {
    setStatus("verifying");
    setMessage(null);
    try {
      const res = await fetch(`/api/auth/verify-email/confirm?ticket=${encodeURIComponent(ticket)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось подтвердить email");
      setStatus("ok");
      setMessage(`Email ${data.email ?? ""} подтверждён.`);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Не удалось подтвердить email");
    }
  };

  if (!ticket) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Ссылка недействительна</h1>
          <p className="mt-2 text-sm text-ink-soft">
            В ссылке отсутствует код подтверждения.
          </p>
          <button
            className="btn btn-secondary mt-6"
            onClick={() => router.push("/profile")}
          >
            В личный кабинет
          </button>
        </div>
      </div>
    );
  }

  if (status === "ok") {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Email подтверждён</h1>
          <p className="mt-2 text-sm text-ink-soft">{message}</p>
          <button
            className="btn btn-primary mt-6"
            onClick={() => router.push("/profile")}
          >
            В личный кабинет
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-bold text-ink">Подтверждение email</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Нажмите, чтобы подтвердить адрес электронной почты. Ссылка одноразовая.
        </p>
        {status === "error" && message && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-bad">{message}</div>
        )}
        <button
          className="btn btn-primary mt-6 w-full"
          disabled={status === "verifying"}
          onClick={verify}
        >
          {status === "verifying" ? "Проверяем…" : "Подтвердить email"}
        </button>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-ink-soft">Загрузка…</div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
