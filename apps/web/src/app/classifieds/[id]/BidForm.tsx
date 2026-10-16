"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/** Исполнитель предлагает цену и срок по заказу услуги. */
export function BidForm({ classifiedId, signedIn }: { classifiedId: string; signedIn: boolean }) {
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!signedIn) {
    return (
      <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm">
        <p className="font-medium">Готовы взяться за заказ?</p>
        <p className="mt-1 text-zinc-600">Войдите, чтобы предложить свою цену и срок.</p>
        <Link href="/login" className="btn btn-primary mt-2 inline-block">Войти</Link>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/classifieds/${classifiedId}/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price, days, text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Не удалось отправить предложение");
        return;
      }
      setSent(true);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
        Предложение отправлено. Заказчик получил уведомление, ответ придёт в{" "}
        <Link href={`/classifieds/${classifiedId}/chat`} className="underline">переписку</Link>. Чтобы изменить цену или срок, отправьте новое предложение: оно заменит прежнее.
        <button type="button" className="mt-2 block text-xs underline" onClick={() => setSent(false)}>Отправить новое предложение</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2 rounded-lg border border-zinc-200 p-3 text-sm">
      <p className="font-medium">Предложить свою цену и срок</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-zinc-600">
          Цена, ₽
          <input className="input mt-1 w-full" inputMode="numeric" placeholder="15 000" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </label>
        <label className="block text-xs text-zinc-600">
          Срок, дней
          <input className="input mt-1 w-full" inputMode="numeric" placeholder="5" value={days} onChange={(e) => setDays(e.target.value)} required />
        </label>
      </div>
      <label className="block text-xs text-zinc-600">
        Как сделаете работу
        <textarea
          className="input mt-1 min-h-[90px] w-full"
          maxLength={800}
          placeholder="Опыт, похожие работы, что входит в цену"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
      </label>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Отправляем…" : "Отправить предложение"}</button>
      <p className="text-xs text-zinc-500">Не пишите телефон и ссылки на мессенджеры: переписка на площадке защищает обе стороны.</p>
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
    </form>
  );
}
