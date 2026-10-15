"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  classifiedId: string;
  /** Указан, когда отвечает автор объявления. */
  applicantId?: string;
  initialText?: string;
  placeholder?: string;
}

/** Отклик на объявление или ответ автора откликнувшемуся. */
export function ClassifiedReplyForm({ classifiedId, applicantId, initialText = "", placeholder = "Напишите сообщение" }: Props) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/classifieds/${classifiedId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, applicantId }),
      });
      const json = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error("Войдите в аккаунт, чтобы отправить сообщение");
      if (!response.ok) throw new Error(json.error ?? "Не удалось отправить сообщение");
      setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить сообщение");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        className="input min-h-24 w-full"
        value={text}
        maxLength={1000}
        placeholder={placeholder}
        aria-label="Текст сообщения"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">{text.length}/1000 · Ctrl+Enter, чтобы отправить</span>
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? "Отправляю…" : "Отправить"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
