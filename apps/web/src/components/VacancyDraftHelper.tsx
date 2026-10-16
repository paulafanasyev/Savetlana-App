"use client";

import { useState } from "react";
import { removedNote, type ContactKind } from "@/lib/domains/contact-scrub";

export interface VacancyDraftResult {
  title: string;
  category: string;
  description: string;
  salaryFrom?: number;
  attrs: Record<string, string>;
}

const COPY = {
  vacancy: {
    endpoint: "/api/classifieds/vacancy-draft",
    heading: "Светлана составит вакансию",
    hint: "Напишите своими словами: кого ищете, что делать, сколько платите, какой график и как оформляете. Например: «Ищем курьера на авто компании, 80-100 тыс на руки, 5/2, без опыта, по ТК».",
    aria: "Вакансия своими словами",
    login: "Войдите в аккаунт, чтобы Светлана помогла с вакансией",
    fail: "Не получилось составить вакансию",
    model: "Светлана заполнила форму ниже. Проверьте каждое поле: она брала условия только из вашего текста.",
    rules: "Светлана разложила ваш текст по полям формы ниже. Проверьте их и допишите, чего не хватает.",
  },
  resume: {
    endpoint: "/api/classifieds/resume-draft",
    heading: "Светлана составит резюме",
    hint: "Напишите своими словами: кем хотите работать, какой у вас опыт и что умеете, какую зарплату и график хотите. Например: «Ищу работу водителем, опыт 7 лет, права B и C, хочу от 80 тыс на руки, 5/2». Телефон и паспортные данные сюда писать не нужно.",
    aria: "Резюме своими словами",
    login: "Войдите в аккаунт, чтобы Светлана помогла с резюме",
    fail: "Не получилось составить резюме",
    model: "Светлана заполнила форму ниже. Проверьте каждое поле: она брала опыт и условия только из вашего текста.",
    rules: "Светлана разложила ваш текст по полям формы ниже. Проверьте их и допишите, чего не хватает.",
  },
} as const;

/** «Светлана составит вакансию» или «…резюме»: текст своими словами превращается в заполненную форму. */
export function VacancyDraftHelper({
  onDraft,
  kind = "vacancy",
  initialText = "",
}: {
  /** sourceText: то, что человек написал сам (модель могла переписать описание и выкинуть город). */
  onDraft: (draft: VacancyDraftResult, sourceText: string) => void;
  kind?: "vacancy" | "resume";
  /** Текст из чата со Светланой: уже вставлен, остаётся нажать «Заполнить форму». */
  initialText?: string;
}) {
  const copy = COPY[kind];
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(copy.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(copy.login);
      if (!res.ok || !data.draft) throw new Error(data.error ?? copy.fail);
      onDraft(data.draft as VacancyDraftResult, text);
      const removed = Array.isArray(data.removed) ? (data.removed as ContactKind[]) : [];
      setNote([data.source === "model" ? copy.model : copy.rules, removedNote(removed)].filter(Boolean).join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.fail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-4">
      <p className="text-sm font-semibold">{copy.heading}</p>
      <p className="text-xs text-zinc-600">{copy.hint}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        aria-label={copy.aria}
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
