"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rub } from "@/lib/format";

interface Row {
  id: string;
  title: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  views: number;
  onPromo: boolean;
  percent: number;
  endsAt: string | null;
}

const DAY_OPTIONS = [0, 1, 3, 7, 14, 30];

function preview(priceKopecks: number, percent: number): number {
  return Math.max(100, Math.round((priceKopecks * (100 - percent)) / 100 / 100) * 100);
}

function dateText(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

function daysLabel(n: number): string {
  if (n === 0) return "без срока";
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "день" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "дня" : "дней";
  return `${n} ${word}`;
}

export function PromotionsForm({ products }: { products: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [percent, setPercent] = useState(10);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const chosen = products.filter((p) => selected.has(p.id));
  const toStart = chosen.filter((p) => !p.onPromo);
  const toEnd = chosen.filter((p) => p.onPromo);
  // Продлевать можно только скидку со сроком: без срока она и так идёт.
  const toExtend = toEnd.filter((p) => p.endsAt);
  const percentOk = Number.isInteger(percent) && percent >= 5 && percent <= 70;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Цены меняются для покупателей сразу, поэтому перед запуском показываем итог и просим подтвердить. */
  function confirmText(action: "start" | "end" | "extend"): string {
    if (action === "extend") {
      const lines = toExtend.slice(0, 8).map((p) => `• ${p.title}: сейчас до ${p.endsAt ? dateText(p.endsAt) : "—"}`);
      if (toExtend.length > 8) lines.push(`• и ещё ${toExtend.length - 8}`);
      return [`Продлить скидку на ${daysLabel(days)}? Цены не изменятся, сдвинется только дата окончания. Вся акция не дольше 30 дней с запуска.`, ...lines].join("\n");
    }
    const rows = action === "start" ? toStart : toEnd;
    const lines = rows.slice(0, 8).map((p) =>
      action === "start"
        ? `• ${p.title}: ${rub(p.priceKopecks)} → ${rub(preview(p.priceKopecks, percent))}`
        : `• ${p.title}: ${rub(p.priceKopecks)} → ${rub(p.oldPriceKopecks ?? p.priceKopecks)}`
    );
    if (rows.length > 8) lines.push(`• и ещё ${rows.length - 8}`);
    const until = days > 0 ? ` до ${dateText(new Date(Date.now() + days * 86_400_000))}` : " без срока";
    const head = action === "start" ? `Запустить скидку ${percent}%${until}? Новые цены увидят все покупатели:` : "Вернуть обычную цену?";
    return [head, ...lines].join("\n");
  }

  async function call(action: "start" | "end" | "extend", ids: string[]) {
    if (!window.confirm(confirmText(action))) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/seller/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productIds: ids, percent, days: days > 0 ? days : undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Не удалось выполнить действие");
      if (action === "start") {
        const parts = [`Скидка ${percent}% запущена, товаров: ${json.started?.length ?? 0}.`];
        if (json.endsAt) parts.push(`${dateText(json.endsAt)} обычная цена вернётся сама.`);
        if (json.skipped?.length) parts.push(`Пропущено: ${json.skipped.length} (уже со скидкой или цену недавно поднимали).`);
        parts.push(json.notified ? `Уведомили покупателей: ${json.notified}.` : "Эти товары пока никто не добавлял в избранное.");
        setMessage(parts.join(" "));
      } else if (action === "extend") {
        const last = json.extended?.[json.extended.length - 1]?.endsAt;
        const parts = [`Скидка продлена, товаров: ${json.extended?.length ?? 0}${last ? `, до ${dateText(last)}` : ""}.`];
        if (json.skipped?.length) parts.push(`Не продлено: ${json.skipped.length} (${json.skipped[0].reason}).`);
        setMessage(parts.join(" "));
      } else {
        setMessage(`Обычная цена возвращена, товаров: ${json.ended?.length ?? 0}.`);
      }
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          Скидка, %
          <input
            className="input mt-1 w-24"
            type="number"
            min={5}
            max={70}
            step={1}
            value={percent}
            onChange={(e) => setPercent(Math.round(Number(e.target.value)))}
          />
        </label>
        <label className="text-sm">
          Срок
          <select className="input mt-1 w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map((n) => (
              <option key={n} value={n}>{daysLabel(n)}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy || !percentOk || toStart.length === 0} onClick={() => void call("start", toStart.map((p) => p.id))}>
          Запустить скидку {percentOk ? `${percent}%` : ""} {toStart.length > 0 ? `(товаров: ${toStart.length})` : ""}
        </button>
        <button className="btn btn-ghost" disabled={busy || toEnd.length === 0} onClick={() => void call("end", toEnd.map((p) => p.id))}>
          Вернуть обычную цену {toEnd.length > 0 ? `(${toEnd.length})` : ""}
        </button>
        <button className="btn btn-ghost" disabled={busy || days === 0 || toExtend.length === 0} onClick={() => void call("extend", toExtend.map((p) => p.id))} title={days === 0 ? "Выберите срок, на сколько продлить" : undefined}>
          Продлить на {days > 0 ? daysLabel(days) : "…"} {toExtend.length > 0 ? `(${toExtend.length})` : ""}
        </button>
        {!percentOk && <span className="text-sm text-red-600">Скидка от 5 до 70%</span>}
      </div>
      <p className="text-xs text-ink-faint">Честная скидка: если цену товара поднимали за последние 14 дней, акцию на него запустить нельзя. Пока идёт акция, цену товара не меняют. Когда срок выйдет, обычная цена вернётся сама.</p>
      {message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900" role="status">{message}</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-faint">
            <tr>
              <th className="py-2 pr-3"><span className="sr-only">Выбрать</span></th>
              <th className="pr-4">Товар</th>
              <th className="pr-4">Цена</th>
              <th className="pr-4">Со скидкой</th>
              <th>Просмотры</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-2 pr-3">
                  <input type="checkbox" aria-label={`Выбрать «${p.title}»`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                </td>
                <td className="pr-4">{p.title}</td>
                <td className="pr-4">
                  {rub(p.priceKopecks)}
                  {p.onPromo && p.oldPriceKopecks && <span className="ml-2 text-ink-faint line-through">{rub(p.oldPriceKopecks)}</span>}
                </td>
                <td className="pr-4">
                  {p.onPromo ? (
                    <span className="chip bg-rose-50 text-rose-800">скидка {p.percent}%{p.endsAt ? ` до ${dateText(p.endsAt)}` : ""}</span>
                  ) : selected.has(p.id) && percentOk ? (
                    <span className="text-svetlana-700">{rub(preview(p.priceKopecks, percent))}</span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td>{p.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
