"use client";

export const dynamic = "force-dynamic";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { rub, timeAgo } from "@/lib/format";

interface Message {
  id: string;
  authorId: string;
  authorRole: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}
interface Evidence {
  id: string;
  kind: string;
  fileName: string;
  sizeBytes: number;
  verified: boolean;
  createdAt: string;
}
interface HistoryEntry {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
}
interface Case {
  dispute: {
    id: string;
    status: string;
    reason: string;
    description: string;
    resolution: string | null;
    reasonCode: string | null;
    sellerSlaUntil: string | null;
    slaBreached: boolean;
    appealedAt: string | null;
    createdAt: string;
    buyer: { id: string; name: string | null };
    sellerProfile: { id: string; displayName: string };
    assignedAdmin: { id: string; name: string | null } | null;
  };
  messages: Message[];
  evidence: Evidence[];
  history: HistoryEntry[];
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыт",
  EVIDENCE_COLLECTION: "Сбор доказательств",
  RESOLVED_BUYER: "Решено в пользу покупателя",
  RESOLVED_SELLER: "Решено в пользу продавца",
  ESCALATED_HUMAN: "Передано модерации",
  CLOSED: "Закрыт",
};

const ACTION_LABEL: Record<string, string> = {
  message: "Сообщение",
  internal_note: "Внутренняя заметка",
  evidence_attached: "Доказательство",
  assigned: "Назначение",
  sla_started: "Начат таймер ответа",
  sla_breached: "Срок ответа нарушен",
  escalated: "Эскалация",
  appeal_filed: "Апелляция",
  resolved: "Решение",
};

export default function DisputeCasePage() {
  const params = useParams<{ id: string }>();
  const disputeId = params?.id;
  const [data, setData] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [appealText, setAppealText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    // Single authoritative source: the case route returns the dispute plus the
    // role-filtered messages, evidence and immutable timeline.
    const res = await fetch(`/api/disputes/${disputeId}`);
    if (!res.ok) {
      setError("Не удалось загрузить спор");
      setLoading(false);
      return;
    }
    const json = (await res.json()) as Case;
    setData(json);
    setLoading(false);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/disputes/${disputeId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Не удалось отправить сообщение");
      return;
    }
    setText("");
    load();
  };

  const appeal = async () => {
    if (appealText.trim().length < 20) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/disputes/${disputeId}/appeal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: appealText }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Не удалось подать апелляцию");
      return;
    }
    setAppealText("");
    setError("Апелляция передана модерации");
    load();
  };

  const uploadEvidence = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "dispute_evidence");
      const up = await fetch("/api/storage/upload", { method: "POST", body: form });
      if (!up.ok) {
        const j = await up.json().catch(() => ({}));
        setError(j.error ?? "Не удалось загрузить файл");
        return;
      }
      const stored = await up.json();
      const link = await fetch(`/api/disputes/${disputeId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: file.type.startsWith("image/") ? "photo" : "document",
          storageKey: stored.key,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          contentHash: stored.contentHash,
        }),
      });
      if (!link.ok) {
        const j = await link.json().catch(() => ({}));
        setError(j.error ?? "Файл загружен, но не прикреплен к спору");
        return;
      }
      load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-slate-500">Загрузка спора…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-red-600">{error ?? "Спор не найден"}</p>
        <Link href="/orders" className="mt-4 inline-block text-sky-600 hover:underline">
          ← К заказам
        </Link>
      </main>
    );
  }

  const d = data.dispute;
  const canAppeal =
    (d.status === "RESOLVED_BUYER" || d.status === "RESOLVED_SELLER") && !d.appealedAt;
  const closed = d.status === "CLOSED";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/orders" className="text-sm text-slate-500 hover:underline">
        ← К заказам
      </Link>

      <header className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Спор по заказу</h1>
            <p className="mt-1 text-sm text-slate-500">
              Продавец: {d.sellerProfile.displayName || "—"} · открыт {timeAgo(new Date(d.createdAt))}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
              d.status === "CLOSED"
                ? "bg-slate-100 text-slate-600"
                : d.status.startsWith("RESOLVED")
                  ? "bg-emerald-50 text-emerald-700"
                  : d.status === "ESCALATED_HUMAN"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-sky-50 text-sky-700"
            }`}
          >
            {STATUS_LABEL[d.status] ?? d.status}
          </span>
        </div>

        {d.reason && (
          <p className="mt-4 text-sm">
            <span className="text-slate-500">Причина:</span> <b>{d.reason}</b>
          </p>
        )}
        {d.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{d.description}</p>}
        {d.resolution && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <span className="text-slate-500">Решение:</span> {d.resolution}
          </div>
        )}
        {d.slaBreached && (
          <p className="mt-3 text-sm text-amber-700">⏱ Срок ответа продавца нарушен — учтено модерацией.</p>
        )}
        {d.appealedAt && (
          <p className="mt-3 text-sm text-amber-700">
            Апелляция подана {timeAgo(new Date(d.appealedAt))} — на рассмотрении у модерации.
          </p>
        )}
      </header>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Messages */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Переписка</h2>
        {data.messages.length === 0 ? (
          <p className="text-sm text-slate-500">Сообщений пока нет.</p>
        ) : (
          <ul className="space-y-3">
            {data.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg p-3 text-sm ${
                  m.isInternal
                    ? "bg-amber-50 text-amber-900"
                    : m.authorRole === "buyer"
                      ? "bg-sky-50"
                      : m.authorRole === "seller"
                        ? "bg-emerald-50"
                        : "bg-slate-50"
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <b className="text-slate-700">
                    {m.authorRole === "buyer" ? "Покупатель" : m.authorRole === "seller" ? "Продавец" : "Модерация"}
                  </b>
                  <span>{timeAgo(new Date(m.createdAt))}</span>
                  {m.isInternal && <span className="text-amber-700">· только для модерации</span>}
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}

        {!closed && (
          <div className="mt-4 flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="Ваше сообщение…"
              className="flex-1 resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-sky-500 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={busy || !text.trim()}
              className="shrink-0 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              Отправить
            </button>
          </div>
        )}
      </section>

      {/* Evidence */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Доказательства</h2>
        {data.evidence.length === 0 ? (
          <p className="text-sm text-slate-500">Файлы не прикреплены.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.evidence.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <span className="text-xl">📎</span>
                <span className="flex-1 truncate">{e.fileName}</span>
                <span className="text-xs text-slate-500">{Math.round(e.sizeBytes / 1024)} КБ</span>
                <span
                  className={`text-xs ${e.verified ? "text-emerald-600" : "text-amber-600"}`}
                >
                  {e.verified ? "проверен" : "на проверке"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!closed && (
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <span>📎 Прикрепить файл</span>
            <input
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadEvidence(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </section>

      {/* Timeline */}
      {data.history.length > 0 && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">Хронология</h2>
          <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
            {data.history.map((h) => (
              <li key={h.id} className="text-sm">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <b className="text-slate-700">{ACTION_LABEL[h.action] ?? h.action}</b>
                  <span>{timeAgo(new Date(h.createdAt))}</span>
                  {h.fromStatus && h.toStatus && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">
                      {h.fromStatus} → {h.toStatus}
                    </span>
                  )}
                </div>
                {h.note && <p className="mt-1 text-slate-600">{h.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Appeal */}
      {canAppeal && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="mb-2 text-lg font-semibold text-amber-900">Обжаловать решение</h2>
          <p className="mb-3 text-sm text-amber-800">
            Апелляция рассматривается модерацией повторно. Автоматических отмен не бывает.
          </p>
          <textarea
            value={appealText}
            onChange={(e) => setAppealText(e.target.value)}
            rows={3}
            placeholder="Почему решение некорректно? (минимум 20 символов)"
            className="w-full resize-none rounded-lg border border-amber-300 bg-white p-3 text-sm focus:outline-none"
          />
          <button
            onClick={appeal}
            disabled={busy || appealText.trim().length < 20}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Подать апелляцию
          </button>
        </section>
      )}

      <div ref={endRef} />
    </main>
  );
}
