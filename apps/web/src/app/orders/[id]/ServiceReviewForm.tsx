"use client";

import { useState, type FormEvent } from "react";

/** Отзыв о работе исполнителя: после принятой работы, один на заказ. */
export function ServiceReviewForm({ orderId, already, onDone }: { orderId: string; already: boolean; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (already || sent) {
    return <p className="mt-4 rounded-lg bg-surface-muted p-3 text-sm text-ink-soft">Отзыв о работе оставлен. Спасибо! Он поможет другим заказчикам выбрать исполнителя.</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length < 10) {
      setMessage("Напишите хотя бы 10 символов");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/service-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, text: text.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body?.error ?? "Не удалось отправить отзыв");
        return;
      }
      setSent(true);
      onDone();
    } catch {
      setMessage("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 border-t border-line pt-4" onSubmit={submit}>
      <h2 className="text-sm font-bold text-ink">Отзыв о работе исполнителя</h2>
      <p className="mt-1 text-xs text-ink-soft">Отзыв появится в профиле исполнителя с пометкой «работа принята через безопасную сделку». Изменить его потом нельзя.</p>
      <label className="mt-2 block text-sm">
        Оценка{" "}
        <select className="input mt-1" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} из 5</option>)}
        </select>
      </label>
      <textarea
        className="input mt-2 min-h-[90px] w-full"
        maxLength={1000}
        placeholder="Как прошла работа: сроки, качество, общение. Не меньше 10 символов"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Текст отзыва о работе исполнителя"
      />
      <button className="btn btn-primary mt-2" disabled={busy}>{busy ? "Отправляем…" : "Отправить отзыв"}</button>
      {message && <p className="mt-2 text-sm text-bad" role="alert">{message}</p>}
    </form>
  );
}
