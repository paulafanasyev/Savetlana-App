"use client";

import { useState } from "react";

export interface VacancyDraftResult {
  title: string;
  category: string;
  description: string;
  salaryFrom?: number;
  attrs: Record<string, string>;
}

/** «Светлана составит вакансию»: текст своими словами превращается в заполненную форму. */
export function VacancyDraftHelper({ onDraft }: { onDraft: (draft: VacancyDraftResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/classifieds/vacancy-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Войдите в аккаунт, чтобы Светлана помогла с вакансией");
      if (!res.ok || !data.draft) throw new Error(data.error ?? "Не получилось составить вакансию");
      onDraft(data.draft as VacancyDraftResult);
      setNote(
        data.source === "model"
          ? "Светлана заполнила форму ниже. Проверьте каждое поле: она брала условия только из вашего текста."
          : "Светлана разложила ваш текст по полям формы ниже. Проверьте их и допишите, чего не хватает.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось составить вакансию");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-4">
      <p className="text-sm font-semibold">Светлана составит вакансию</p>
      <p className="text-xs text-zinc-600">
        Напишите своими словами: кого ищете, что делать, сколько платите, какой график и как оформляете. Например: «Ищем курьера на авто компании, 80-100 тыс на руки, 5/2, без опыта, по ТК».
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        aria-label="Вакансия своими словами"
      />
      <button
        type="button"
        onClick={run}
        disabled={busy || text.trim().length < 15}
        className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? "Светлана составляет…" : "Заполнить форму"}
      </button>
      {note && <p className="text-xs text-green-800" role="status">{note}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
