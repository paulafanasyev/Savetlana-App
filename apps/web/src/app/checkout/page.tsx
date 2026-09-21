"use client";

import Link from "next/link";
import { useState } from "react";
import { rub } from "@/lib/format";

export default function CheckoutPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    orders: Array<{ id: string; number: string; totalKopecks: number; itemsCount: number }>;
    riskLevel: string;
    riskExplanation: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ city: "", street: "", house: "", apartment: "", zip: "", recipientName: "", phone: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, idempotencyKey: `ck-${Date.now()}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось оформить заказ");
      setResult(data);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Не удалось оформить заказ");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const total = result.orders.reduce((s, o) => s + o.totalKopecks, 0);
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Заказ оформлен</h1>
          <p className="mt-2 text-ink-soft">
            Создано заказов: {result.orders.length}, на сумму {rub(total)}.
          </p>
          {result.riskLevel === "REVIEW" || result.riskLevel === "BLOCKED" ? (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-800">
              Заказ отправлен на дополнительную проверку.
              {result.riskExplanation ? ` Причина: ${result.riskExplanation}` : ""}
              <div className="mt-1 text-xs">Платёж будет принят после проверочных процедур.</div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-ink-soft">Заказ ожидает оплаты.</div>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/orders" className="btn btn-primary">
              Мои заказы
            </Link>
            <Link href="/" className="btn btn-ghost">
              На главную
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Оформление заказа</h1>
      <form className="card space-y-4 p-6" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-4">
          <label className="col-span-2 block">
            <span className="mb-1 block text-sm font-medium text-ink">Город</span>
            <input
              className="input"
              required
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-sm font-medium text-ink">Улица, дом</span>
            <input
              className="input"
              required
              value={form.street}
              onChange={(e) => setForm({ ...form, street: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Квартира</span>
            <input className="input" value={form.apartment} onChange={(e) => setForm({ ...form, apartment: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Индекс</span>
            <input className="input" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Получатель</span>
            <input
              className="input"
              required
              value={form.recipientName}
              onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Телефон</span>
            <input
              className="input"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
        </div>
        {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">{error}</div>}
        <div className="rounded-xl bg-surface-muted p-3 text-xs text-ink-soft">
          Нажимая «Оформить», вы принимаете условия покупки. Оплата проходит через
          платёжного партнёра — платформа не хранит средства клиентов на собственных счетах.
        </div>
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Оформляем…" : "Оформить заказ"}
        </button>
      </form>
    </div>
  );
}
