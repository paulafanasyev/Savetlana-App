"use client";

import { useState, type FormEvent } from "react";

type Seller = { sellerType: string; displayName: string; inn: string | null; ogrn: string | null };

export function SellerOnboardingForm({ initial, disabled }: { initial: Seller; disabled: boolean }) {
  const [sellerType, setSellerType] = useState(initial.sellerType === "INDIVIDUAL" ? "SELF_EMPLOYED" : initial.sellerType);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [inn, setInn] = useState(initial.inn ?? "");
  const [ogrn, setOgrn] = useState(initial.ogrn ?? "");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const needsOgrn = sellerType !== "SELF_EMPLOYED";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/seller/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerType, displayName, inn, ogrn: needsOgrn ? ogrn : undefined }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error ?? "Не удалось отправить заявку"); return; }
    setSent(true);
  }

  if (disabled && !sent) return null;
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-white p-6">
      <label className="block">Кто вы?
        <select className="mt-1 w-full rounded border p-2" value={sellerType} onChange={(e) => setSellerType(e.target.value)} disabled={disabled}>
          <option value="SELF_EMPLOYED">Самозанятый</option><option value="IP">ИП</option><option value="COMPANY">ООО</option>
        </select>
      </label>
      <label className="block">Название магазина<input className="mt-1 w-full rounded border p-2" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={disabled} /></label>
      <label className="block">ИНН<input inputMode="numeric" className="mt-1 w-full rounded border p-2" value={inn} onChange={(e) => setInn(e.target.value)} disabled={disabled} /></label>
      {needsOgrn && <label className="block">ОГРН или ОГРНИП<input inputMode="numeric" className="mt-1 w-full rounded border p-2" value={ogrn} onChange={(e) => setOgrn(e.target.value)} disabled={disabled} /></label>}
      {error && <p className="text-red-700">{error}</p>}
      {sent && <p className="text-green-700">Заявка отправлена на проверку.</p>}
      {!disabled && <button className="rounded bg-ink px-4 py-2 text-white" type="submit">Отправить на проверку</button>}
    </form>
  );
}
