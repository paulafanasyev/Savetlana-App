"use client";

import { useState } from "react";

type Field = "recipientName" | "inn" | "kpp" | "bik" | "bankName" | "corrAccount" | "account";

const FIELDS: { key: Field; label: string; hint?: string; numeric?: boolean; max: number }[] = [
  { key: "recipientName", label: "Получатель", hint: "Как в банке: ФИО, «ИП Иванов И. И.» или название организации", max: 160 },
  { key: "inn", label: "ИНН", hint: "Тот же, что у магазина", numeric: true, max: 12 },
  { key: "kpp", label: "КПП", hint: "Только у организаций", numeric: true, max: 9 },
  { key: "bik", label: "БИК банка", numeric: true, max: 9 },
  { key: "bankName", label: "Банк", max: 160 },
  { key: "corrAccount", label: "Корреспондентский счёт", numeric: true, max: 20 },
  { key: "account", label: "Расчётный счёт", numeric: true, max: 20 },
];

/** Реквизиты для выплат. Полный номер счёта после сохранения не показывается. */
export function BankDetailsForm({ current }: { current: { recipientName: string; bankName: string; accountMasked: string } | null }) {
  const [open, setOpen] = useState(!current);
  const [values, setValues] = useState<Record<Field, string>>({ recipientName: "", inn: "", kpp: "", bik: "", bankName: "", corrAccount: "", account: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    setErrors({});
    try {
      const res = await fetch("/api/seller/bank-details", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(json.fields ?? {});
        throw new Error(json.error ?? "Не удалось сохранить");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Реквизиты для выплат</h2>
        {current && !open && <button className="btn btn-ghost" onClick={() => setOpen(true)}>Изменить</button>}
      </div>
      {current && !open && (
        <p className="text-sm text-ink-soft">{current.recipientName} · {current.bankName} · счёт {current.accountMasked}</p>
      )}
      {open && (
        <>
          <p className="text-sm text-ink-soft">Реквизиты хранятся зашифрованными. Деньги переводим только на счёт с ИНН вашего магазина.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className={`block text-sm${f.key === "recipientName" ? " sm:col-span-2" : ""}`}>
                {f.label}
                <input
                  className={`input mt-1 w-full${errors[f.key] ? " border-bad" : ""}`}
                  value={values[f.key]}
                  maxLength={f.max}
                  inputMode={f.numeric ? "numeric" : undefined}
                  aria-invalid={errors[f.key] ? true : undefined}
                  aria-describedby={errors[f.key] ? `bank-err-${f.key}` : undefined}
                  onChange={(e) => setValues({ ...values, [f.key]: f.numeric ? e.target.value.replace(/\D/g, "") : e.target.value })}
                />
                {errors[f.key] ? (
                  <span id={`bank-err-${f.key}`} className="mt-1 block text-xs text-bad">{errors[f.key]}</span>
                ) : f.hint ? (
                  <span className="mt-1 block text-xs text-ink-faint">{f.hint}</span>
                ) : null}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Сохраняем…" : "Сохранить реквизиты"}</button>
            {current && <button className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>}
          </div>
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
