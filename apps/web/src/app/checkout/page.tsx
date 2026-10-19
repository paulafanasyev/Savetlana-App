"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes } from "react";
import { rub } from "@/lib/format";
import { readCityCookie } from "@/lib/my-city";
import { DELIVERY_OPTIONS, deliveryHint, deliveryPrice, pickupElsewhere, type DeliveryMethod } from "@/lib/delivery-options";

interface CheckoutResult {
  orders: Array<{ id: string; number: string; totalKopecks: number; deliveryKopecks?: number; itemsCount: number }>;
  priceChanges?: Array<{ title: string; snapshotKopecks: number; liveKopecks: number; chargedKopecks: number }>;
  riskLevel: string;
  riskExplanation: string | null;
}

interface SellerRow { sellerId: string; sellerName: string; subtotalKopecks: number; itemsCount: number; shipCity?: string | null }

type FormState = { city: string; street: string; house: string; apartment: string; zip: string; recipientName: string; phone: string };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `ck-${crypto.randomUUID()}` : `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validate(f: FormState, needsAddress: boolean): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  if (needsAddress) {
    if (f.city.trim().length < 2) e.city = "Укажите город";
    if (f.street.trim().length < 2) e.street = "Укажите улицу";
    if (!f.house.trim()) e.house = "Укажите дом";
  }
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
  // One key per checkout attempt: a double click or a retry must not create a second set of orders.
  const [idempotencyKey] = useState(newKey);
  const [form, setForm] = useState<FormState>({ city: "", street: "", house: "", apartment: "", zip: "", recipientName: "", phone: "" });
  const [sellers, setSellers] = useState<SellerRow[] | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [choice, setChoice] = useState<Record<string, DeliveryMethod>>({});
  // «Мой город» из куки: чтобы предупредить про самовывоз в другом городе.
  const [myCity, setMyCity] = useState<string | null>(null);

  useEffect(() => {
    setMyCity(readCityCookie(document.cookie));
    void fetch("/api/checkout/options")
      .then(async (r) => {
        if (r.status === 401) return setLoadState("auth");
        if (!r.ok) return setLoadState("error");
        const d = (await r.json()) as { sellers?: SellerRow[] };
        setSellers(d.sellers ?? []);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, []);

  const methodFor = (sellerId: string): DeliveryMethod => choice[sellerId] ?? "PICKUP";
  const needsAddress = (sellers ?? []).some((s) => methodFor(s.sellerId) === "SELLER");
  const subtotal = (sellers ?? []).reduce((sum, s) => sum + s.subtotalKopecks, 0);
  const deliveryTotal = (sellers ?? []).reduce((sum, s) => sum + deliveryPrice(methodFor(s.sellerId)), 0);

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = validate(form, needsAddress);
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError("Проверьте отмеченные поля");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const deliveryBySeller = Object.fromEntries((sellers ?? []).map((s) => [s.sellerId, { method: methodFor(s.sellerId) }]));
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, idempotencyKey, deliveryBySeller }),
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
            Создано заказов: {result.orders.length}, на сумму {rub(total)} (вместе с доставкой).
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
              <Link href={`/orders/${result.orders[0].id}`} className="btn btn-primary">Перейти к оплате</Link>
            ) : (
              <Link href="/orders" className="btn btn-primary">Оплатить заказы</Link>
            )}
            <Link href="/" className="btn btn-ghost">На главную</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadState === "auth") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold">Оформление заказа</h1>
          <p className="mt-2 text-ink-soft">Войдите, чтобы оформить заказ.</p>
          <Link href="/login?next=%2Fcheckout" className="btn btn-primary mt-4 inline-flex">Войти</Link>
        </div>
      </div>
    );
  }
  if (loadState === "ready" && sellers && sellers.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold">Корзина пуста</h1>
          <Link href="/catalog" className="btn btn-primary mt-4 inline-flex">В каталог</Link>
        </div>
      </div>
    );
  }

  const field = (k: keyof FormState, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}, wide = false) => (
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
        <span id={`err-${k}`} className="mt-1 block text-xs text-bad">{fieldErrors[k]}</span>
      )}
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">Оформление заказа</h1>
      <form className="card space-y-5 p-6" onSubmit={submit} noValidate>
        <section>
          <h2 className="mb-2 text-lg font-semibold">Доставка</h2>
          {loadState === "loading" && <div className="h-16 animate-pulse rounded-xl bg-surface-muted" />}
          {loadState === "error" && <p className="text-sm text-bad">Не удалось загрузить корзину. Обновите страницу.</p>}
          {(sellers ?? []).map((s) => (
            <fieldset key={s.sellerId} className="mb-3 rounded-xl border border-surface-line p-3">
              <legend className="px-1 text-sm font-medium">
                {s.sellerName}{s.shipCity ? ` · из г. ${s.shipCity}` : ""} · товаров: {s.itemsCount} · {rub(s.subtotalKopecks)}
              </legend>
              {DELIVERY_OPTIONS.map((o) => (
                <label key={o.method} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
                  <input
                    type="radio"
                    name={`delivery-${s.sellerId}`}
                    checked={methodFor(s.sellerId) === o.method}
                    onChange={() => setChoice({ ...choice, [s.sellerId]: o.method })}
                    className="mt-1"
                  />
                  <span>
                    <b>{o.label}</b> · {o.priceKopecks ? rub(o.priceKopecks) : "бесплатно"}
                    <span className="block text-xs text-ink-soft">{deliveryHint(o, s.shipCity)}</span>
                  </span>
                </label>
              ))}
              {pickupElsewhere(methodFor(s.sellerId), s.shipCity, myCity) && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
                  Продавец в г. {s.shipCity}, а ваш город {myCity}. Забрать заказ нужно будет там, или выберите доставку.
                </p>
              )}
            </fieldset>
          ))}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">{needsAddress ? "Адрес и получатель" : "Получатель"}</h2>
          <div className="grid grid-cols-2 gap-4">
            {needsAddress && field("city", "Город", { autoComplete: "address-level2", required: true }, true)}
            {needsAddress && field("street", "Улица", { autoComplete: "address-line1", required: true }, true)}
            {needsAddress && field("house", "Дом", { required: true })}
            {needsAddress && field("apartment", "Квартира", { placeholder: "Необязательно" })}
            {needsAddress && field("zip", "Индекс", { inputMode: "numeric", autoComplete: "postal-code", placeholder: "Необязательно" })}
            {field("recipientName", "Получатель", { autoComplete: "name", required: true }, !needsAddress)}
            {field("phone", "Телефон", { type: "tel", autoComplete: "tel", placeholder: "+7 900 000-00-00", required: true }, true)}
          </div>
        </section>

        {sellers && sellers.length > 0 && (
          <dl className="space-y-1 rounded-xl bg-surface-muted p-3 text-sm">
            <div className="flex justify-between"><dt>Товары</dt><dd>{rub(subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Доставка</dt><dd>{deliveryTotal ? rub(deliveryTotal) : "бесплатно"}</dd></div>
            <div className="flex justify-between text-base font-bold"><dt>К оплате</dt><dd>{rub(subtotal + deliveryTotal)}</dd></div>
          </dl>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</div>
        )}
        <div className="rounded-xl bg-surface-muted p-3 text-xs text-ink-soft">
          Нажимая «Оформить», вы принимаете <Link href="/legal/offer" className="underline">условия покупки</Link>. Оплата проходит через платёжного партнёра:
          платформа не хранит средства клиентов на собственных счетах.
        </div>
        <button className="btn btn-primary w-full" disabled={busy || loadState !== "ready"}>
          {busy ? "Оформляем…" : `Оформить заказ${sellers && sellers.length ? ` на ${rub(subtotal + deliveryTotal)}` : ""}`}
        </button>
      </form>
    </div>
  );
}
