"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROMO_PLANS, type PromoPlan } from "@/lib/promo";
import type { PromotableItem } from "@/lib/domains/promotions";

/** Выбор, что продвигать и на какой срок. */
export function PromoteForm({ items }: { items: PromotableItem[] }) {
  const router = useRouter();
  const [item, setItem] = useState(`${items[0].kind}/${items[0].id}`);
  const [planId, setPlanId] = useState<PromoPlan["id"]>("week");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const plan = PROMO_PLANS.find((p) => p.id === planId) ?? PROMO_PLANS[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const [kind, itemId] = item.split("/");
    try {
      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ kind, itemId, planId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Не удалось включить продвижение");
      setMessage({ ok: true, text: "Продвижение включено" });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Не удалось включить продвижение" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-4">
      <div>
        <label htmlFor="promo-item" className="mb-1 block text-sm font-medium">Что продвигать</label>
        <select id="promo-item" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" value={item} onChange={(e) => setItem(e.target.value)}>
          {items.map((i) => (
            <option key={`${i.kind}/${i.id}`} value={`${i.kind}/${i.id}`}>
              {i.kind === "product" ? "Товар" : "Объявление"}: {i.title}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Срок</legend>
        <div className="flex flex-wrap gap-2">
          {PROMO_PLANS.map((p) => (
            <label key={p.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${p.id === planId ? "border-svetlana-600 bg-svetlana-50" : "border-zinc-300"}`}>
              <input type="radio" name="plan" value={p.id} checked={p.id === planId} onChange={() => setPlanId(p.id)} className="sr-only" />
              {p.label}: {p.priceRub} ₽
            </label>
          ))}
        </div>
      </fieldset>
      {message && (
        <p className={message.ok ? "text-sm text-green-700" : "text-sm text-red-700"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-60">
        {busy ? "Включаем…" : `Продвинуть за ${plan.priceRub} ₽`}
      </button>
      <p className="text-xs text-ink-soft">Если продвижение уже идёт, дни добавятся к концу срока.</p>
    </form>
  );
}
