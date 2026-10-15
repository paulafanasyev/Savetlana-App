"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/** Отзыв о товаре: оценка звёздами и текст. */
export function ReviewForm({ productId, orderId }: { productId: string; orderId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (rating < 1) return setError("Поставьте оценку от 1 до 5 звёзд.");
    if (body.trim().length < 10) return setError("Напишите хотя бы пару предложений, от 10 символов.");
    setBusy(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, orderId, rating, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось отправить отзыв");
      setDone(
        data.status === "moderation"
          ? "Спасибо! Отзыв на проверке у модератора. Другие покупатели увидят его после проверки, обычно в течение суток."
          : "Спасибо! Отзыв опубликован.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить отзыв");
    } finally {
      setBusy(false);
    }
  };

  if (done) return <p className="text-sm text-green-700">{done}</p>;

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-1" role="radiogroup" aria-label="Оценка">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} из 5`}
            onClick={() => setRating(n)}
            className={`text-2xl ${n <= rating ? "text-amber-500" : "text-ink-faint"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="Что понравилось, что нет, совпал ли товар с описанием"
        className="w-full rounded-lg border border-surface-line px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-bad">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">
        {busy ? "Отправляем…" : "Отправить отзыв"}
      </button>
    </form>
  );
}
