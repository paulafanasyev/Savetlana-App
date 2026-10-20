"use client";

import { useState, type FormEvent } from "react";
import { cleanDigits, innHint, ogrnHint } from "@/lib/requisites-hint";

type Seller = { sellerType: string; displayName: string; inn: string | null; ogrn: string | null };

export function SellerOnboardingForm({ initial, disabled }: { initial: Seller; disabled: boolean }) {
  const [sellerType, setSellerType] = useState(initial.sellerType === "INDIVIDUAL" ? "SELF_EMPLOYED" : initial.sellerType);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [inn, setInn] = useState(initial.inn ?? "");
  const [ogrn, setOgrn] = useState(initial.ogrn ?? "");
  const [touched, setTouched] = useState({ inn: false, ogrn: false });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const needsOgrn = sellerType !== "SELF_EMPLOYED";
  const innProblem = innHint(inn, sellerType);
  const ogrnProblem = needsOgrn ? ogrnHint(ogrn, sellerType) : null;
  const showInn = (touched.inn || tried) && innProblem;
  const showOgrn = (touched.ogrn || tried) && ogrnProblem;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setTried(true);
    if (innProblem || ogrnProblem) return;
    setBusy(true);
    const response = await fetch("/api/seller/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerType, displayName, inn: cleanDigits(inn), ogrn: needsOgrn ? cleanDigits(ogrn) : undefined }) }).catch(() => null);
    setBusy(false);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (!response || !response.ok) { setError(body.error ?? "Не удалось отправить заявку"); return; }
    setSent(true);
  }

  if (disabled && !sent) return null;
  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-line bg-white p-6">
      <label className="block">Кто вы?
        <select className="mt-1 w-full rounded border p-2" value={sellerType} onChange={(e) => setSellerType(e.target.value)} disabled={disabled}>
          <option value="SELF_EMPLOYED">Самозанятый</option><option value="IP">ИП</option><option value="COMPANY">ООО</option>
        </select>
      </label>
      <label className="block">Название магазина<input className="mt-1 w-full rounded border p-2" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={disabled} /></label>
      <label className="block">ИНН
        <input
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          className={`mt-1 w-full rounded border p-2 ${showInn ? "border-red-500" : ""}`}
          value={inn}
          onChange={(e) => setInn(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, inn: true }))}
          aria-invalid={Boolean(showInn)}
          aria-describedby="inn-hint"
          disabled={disabled}
        />
        <span id="inn-hint" className={`mt-1 block text-sm ${showInn ? "text-red-700" : "text-ink-soft"}`}>
          {showInn ? innProblem : sellerType === "COMPANY" ? "10 цифр" : "12 цифр, как в приложении «Мой налог» или свидетельстве ИНН"}
        </span>
      </label>
      {needsOgrn && (
        <label className="block">{sellerType === "IP" ? "ОГРНИП" : "ОГРН"}
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={24}
            className={`mt-1 w-full rounded border p-2 ${showOgrn ? "border-red-500" : ""}`}
            value={ogrn}
            onChange={(e) => setOgrn(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, ogrn: true }))}
            aria-invalid={Boolean(showOgrn)}
            aria-describedby="ogrn-hint"
            disabled={disabled}
          />
          <span id="ogrn-hint" className={`mt-1 block text-sm ${showOgrn ? "text-red-700" : "text-ink-soft"}`}>
            {showOgrn ? ogrnProblem : sellerType === "IP" ? "15 цифр, есть в выписке ЕГРИП" : "13 цифр, есть в выписке ЕГРЮЛ"}
          </span>
        </label>
      )}
      {error && <p className="text-red-700" role="alert">{error}</p>}
      {sent && <p className="text-green-700" role="status">Заявка отправлена на проверку.</p>}
      {!disabled && <button className="rounded bg-ink px-4 py-2 text-white disabled:opacity-60" type="submit" disabled={busy}>{busy ? "Отправляем…" : "Отправить на проверку"}</button>}
    </form>
  );
}
