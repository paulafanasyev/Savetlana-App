"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useState } from "react";
import { rub } from "@/lib/format";

interface CheckoutResult {
  orders: Array<{ id: string; number: string; totalKopecks: number; itemsCount: number }>;
  priceChanges?: Array<{ title: string; snapshotKopecks: number; liveKopecks: number; chargedKopecks: number }>;
  riskLevel: string;
  riskExplanation: string | null;
}

type FormState = { city: string; street: string; house: string; apartment: string; zip: string; recipientName: string; phone: string };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `ck-${crypto.randomUUID()}` : `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validate(f: FormState): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  if (f.city.trim().length < 2) e.city = "Укажите город";
  if (f.street.trim().length < 2) e.street = "Укажите улицу";
  if (!f.house.trim()) e.house = "Укажите дом";
  if (f.recipientName.trim().length < 2) e.recipientName = "Укажите получателя";
  const digits = f.phone.replace(/\D/g, "");
  if (digits.length !== 11 || !/^[78]/.test(digits)) e.phone = "Телефон в формате +7 900 000-00-00";
  if (f.zip && !/^\d{6}$/.test(f.zip.trim())) e.zip = "Индекс из 6 цифр";
  return e;
}

export default function CheckoutPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  // One key per checkout attempt: a double click or a retry after a network
  // error must not create a second set of orders.
  const [idempotencyKey] = useState(newKey);
  const [form, setForm] = useState<FormState>({ city: "", street: "", house: "", apartment: "", zip: "", recipientName: "", phone: "" });

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = validate(form);
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError("Проверьте отмеченные поля");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, idempotencyKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Войдите в аккаунт, чтобы оформить заказ");
      if (!res.ok) throw new Error(data.error ?? "Не удалось оформить заказ");
      setResult(data as CheckoutResult);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Не удалось оформить заказ");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const total = result.orders.reduce((s, o) => s + o.totalKopecks, 0);
    const changes = result.priceChanges ?? [];
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-bold text-ink">Заказ оформлен</h1>
          <p className="mt-2 text-ink-soft">
            Создано заказов: {result.orders.length}, на сумму {rub(total)}.
          </p>
          {changes.length > 0 && (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-800" role="status">
              <div className="font-semibold">Цена изменилась с момента добавления в корзину:</div>
              <ul className="mt-2 space-y-1">
                {changes.map((c) => (
                  <li key={c.title}>
                    {c.title}: было {rub(c.snapshotKopecks)}, к оплате {rub(c.chargedKopecks)}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs">Если новая цена не подходит, отмените заказ до оплаты в разделе «Мои заказы».</div>
            </div>
          )}
          {result.riskLevel === "REVIEW" || result.riskLevel === "BLOCKED" ? (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-800">
              Заказ отправлен на дополнительную проверку.
              {result.riskExplanation ? ` Причина: ${result.riskExplanation}` : ""}
              <div className="mt-1 text-xs">Платёж будет принят после проверочных процедур.</div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-ink-soft">Заказ ожидает оплаты.</div>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {result.orders.length === 1 ? (
              <Link href={`/orders/${result.orders[0].id}`} className="btn btn-primary">
                Перейти к оплате
              </Link>
            ) : (
              <Link href="/orders" className="btn btn-primary">
                Оплатить заказы
              </Link>
            )}
            <Link href="/" className="btn btn-ghost">
              На главную
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const field = (k: keyof FormState, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, wide = false) => (
    <label className={`${wide ? "col-span-2 " : ""}block`}>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        className={`input${fieldErrors[k] ? " border-bad" : ""}`}
        value={form[k]}
        onChange={set(k)}
        aria-invalid={fieldErrors[k] ? true : undefined}
        aria-describedby={fieldErrors[k] ? `err-${k}` : undefined}
        {...props}
      />
      {fieldErrors[k] && (
        <span id={`err-${k}`} className="mt-1 block text-xs text-bad">
          {fieldErrors[k]}
        </span>
      )}
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Оформление заказа</h1>
      <form className="card space-y-4 p-6" onSubmit={submit} noValidate>
        <div className="grid grid-cols-2 gap-4">
          {field("city", "Город", { autoComplete: "address-level2", required: true }, true)}
          {field("street", "Улица", { autoComplete: "address-line1", required: true }, true)}
          {field("house", "Дом", { required: true })}
          {field("apartment", "Квартира", { placeholder: "Необязательно" })}
          {field("zip", "Индекс", { inputMode: "numeric", autoComplete: "postal-code", placeholder: "Необязательно" })}
          {field("recipientName", "Получатель", { autoComplete: "name", required: true })}
          {field("phone", "Телефон", { type: "tel", autoComplete: "tel", placeholder: "+7 900 000-00-00", required: true }, true)}
        </div>
        {error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">
            {error}
          </div>
        )}
        <div className="rounded-xl bg-surface-muted p-3 text-xs text-ink-soft">
          Нажимая «Оформить», вы принимаете условия покупки. Оплата проходит через платёжного партнёра: платформа не хранит средства
          клиентов на собственных счетах.
        </div>
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Оформляем…" : "Оформить заказ"}
        </button>
      </form>
    </div>
  );
}
