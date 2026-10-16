"use client";

import { useMemo, useState } from "react";
import { negotiate, sellerBounds, normalizePolicy, type VolumeTier } from "@/lib/negotiation";

interface Policy {
  enabled: boolean;
  maxDiscountPercent: number;
  negotiablePercent: number;
  minOrderQty: number;
  volumeTiers: VolumeTier[];
  custom: boolean;
}

const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;

export function NegotiationPolicyForm({ initial }: { initial: Policy }) {
  const [policy, setPolicy] = useState<Policy>(initial);
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Policy>(key: K, value: Policy[K]) => setPolicy((p) => ({ ...p, [key]: value }));
  const setTier = (i: number, key: keyof VolumeTier, value: number) =>
    setPolicy((p) => ({ ...p, volumeTiers: p.volumeTiers.map((t, j) => (j === i ? { ...t, [key]: value } : t)) }));

  // Пример для наглядности: прайс 1 000 ₽, партия 100 шт.
  const example = useMemo(() => {
    const rules = { listPriceKopecks: 100000, volumeTiers: policy.volumeTiers, maxDiscountPercent: policy.maxDiscountPercent, negotiablePercent: policy.negotiablePercent, minOrderQty: policy.minOrderQty, stockQty: 1000, maxRounds: 6 };
    const bounds = sellerBounds(normalizePolicy(rules), 100);
    const deal = negotiate(rules, { quantity: 100, targetPriceKopecks: 70000, maxPriceKopecks: 100000, maxRounds: 6 });
    return { bounds, deal };
  }, [policy]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/seller/negotiation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const data = (await res.json().catch(() => ({}))) as { policy?: Policy; error?: string };
      if (!res.ok || !data.policy) {
        setStatus(data.error ?? "Не удалось сохранить, попробуйте ещё раз");
      } else {
        setPolicy(data.policy);
        setStatus("Сохранено. Агент торгуется по этим правилам.");
      }
    } catch {
      setStatus("Нет связи с сервером, попробуйте ещё раз");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-4 rounded-xl border p-5">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={policy.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <span className="font-medium">Разрешить агенту торговаться за меня</span>
        </label>
        <p className="text-sm text-ink-soft">Выключите, и агент будет отвечать покупателям, что цена только по прайсу.</p>

        <label className="block text-sm">
          <span className="font-medium">Максимальная скидка, %</span>
          <input type="number" min={0} max={70} className="mt-1 w-full rounded border px-3 py-2" value={policy.maxDiscountPercent} onChange={(e) => set("maxDiscountPercent", Number(e.target.value))} />
          <span className="mt-1 block text-xs text-ink-soft">Абсолютный предел для любой партии, не больше 70%.</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Торг сверх скидки за объём, %</span>
          <input type="number" min={0} max={70} className="mt-1 w-full rounded border px-3 py-2" value={policy.negotiablePercent} onChange={(e) => set("negotiablePercent", Number(e.target.value))} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Минимальная партия для торга, шт.</span>
          <input type="number" min={1} className="mt-1 w-full rounded border px-3 py-2" value={policy.minOrderQty} onChange={(e) => set("minOrderQty", Number(e.target.value))} />
        </label>

        <div className="space-y-2">
          <div className="text-sm font-medium">Скидки за объём (даются сразу)</div>
          {policy.volumeTiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span>от</span>
              <input type="number" min={2} className="w-24 rounded border px-2 py-1" value={t.minQty} onChange={(e) => setTier(i, "minQty", Number(e.target.value))} />
              <span>шт.</span>
              <input type="number" min={0} max={70} className="w-20 rounded border px-2 py-1" value={t.discountPercent} onChange={(e) => setTier(i, "discountPercent", Number(e.target.value))} />
              <span>%</span>
              <button type="button" className="text-rose-700" onClick={() => set("volumeTiers", policy.volumeTiers.filter((_, j) => j !== i))}>убрать</button>
            </div>
          ))}
          {policy.volumeTiers.length < 5 && (
            <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => set("volumeTiers", [...policy.volumeTiers, { minQty: 500, discountPercent: Math.min(12, policy.maxDiscountPercent) }])}>
              Добавить уровень
            </button>
          )}
        </div>

        <button type="button" disabled={saving} className="rounded bg-blue-900 px-4 py-2 font-medium text-white disabled:opacity-60" onClick={save}>
          {saving ? "Сохраняю…" : "Сохранить правила"}
        </button>
        {status && <p className="text-sm">{status}</p>}
        {!policy.custom && <p className="text-xs text-ink-soft">Сейчас действуют правила площадки по умолчанию.</p>}
      </section>

      <section className="space-y-2 rounded-xl border p-5">
        <h2 className="font-semibold">Как это сработает</h2>
        <p className="text-sm text-ink-soft">Пример: товар за 1 000 ₽, покупатель хочет 100 шт. по 700 ₽ и готов платить до 1 000 ₽.</p>
        <ul className="space-y-1 text-sm">
          <li>Агент начнёт с цены <strong>{rub(example.bounds.openKopecks)}</strong> (скидка за объём {example.bounds.openDiscount}%).</li>
          <li>Ниже <strong>{rub(example.bounds.floorKopecks)}</strong> не уступит никогда.</li>
          <li>
            Итог примера:{" "}
            <strong>{policy.enabled ? (example.deal.unitPriceKopecks !== null ? `${rub(example.deal.unitPriceKopecks)} за штуку, раундов: ${example.deal.rounds}` : example.deal.reason) : "торг выключен, цена по прайсу"}</strong>
          </li>
        </ul>
        <p className="text-xs text-ink-soft">Изменения записываются в журнал действий. Посмотреть, как торгуются агенты, можно на странице «B2B-переговоры агентов» (/b2b/negotiation).</p>
      </section>
    </div>
  );
}
