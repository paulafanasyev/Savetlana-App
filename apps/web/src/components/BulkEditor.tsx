"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv } from "@/lib/domains/bulk-rules";

export interface BulkRow {
  id: string;
  sku: string;
  title: string;
  status: string;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  quantity: number;
}

interface Draft { price: string; stock: string }

const STATUS_RU: Record<string, string> = { DRAFT: "Черновик", ACTIVE: "В продаже", ARCHIVED: "В архиве", MODERATION: "На проверке" };

export function BulkEditor({ rows, verified }: { rows: BulkRow[]; verified: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, { price: String(r.priceKopecks / 100), stock: String(r.quantity) }])) as Record<string, Draft>, [rows]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [percent, setPercent] = useState("");
  const [stockAll, setStockAll] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  const visible = rows.filter((r) => !query.trim() || `${r.title} ${r.sku}`.toLowerCase().includes(query.trim().toLowerCase()));
  const onPromo = (r: BulkRow) => r.oldPriceKopecks !== null && r.oldPriceKopecks > r.priceKopecks;
  const draftOf = (id: string): Draft => drafts[id] ?? initial[id];
  const changed = rows.filter((r) => draftOf(r.id).price !== initial[r.id].price || draftOf(r.id).stock !== initial[r.id].stock);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? initial[id]), ...patch } }));
  }
  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === visible.length ? new Set<string>() : new Set(visible.map((r) => r.id))));
  }
  function applyPercent() {
    const p = Number(percent.replace(",", "."));
    if (!Number.isFinite(p) || p === 0 || p < -90 || p > 300) { setMessage("Укажите процент от -90 до 300, например 10 или -5"); return; }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (!selected.has(r.id) || onPromo(r)) continue;
        next[r.id] = { ...(next[r.id] ?? initial[r.id]), price: String(Math.max(1, Math.round((r.priceKopecks / 100) * (1 + p / 100)))) };
      }
      return next;
    });
    setMessage(`Цены выбранных товаров изменены на ${p > 0 ? "+" : ""}${p}% в таблице. Товары со скидкой не тронуты. Проверьте и нажмите «Сохранить».`);
  }
  function applyStock() {
    const q = Number(stockAll);
    if (stockAll.trim() === "" || !Number.isInteger(q) || q < 0) { setMessage("Остаток: целое число от 0"); return; }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows) if (selected.has(r.id)) next[r.id] = { ...(next[r.id] ?? initial[r.id]), stock: String(q) };
      return next;
    });
    setMessage(`Остаток ${q} шт. проставлен выбранным товарам в таблице. Нажмите «Сохранить».`);
  }
  function exportCsv() {
    const csv = toCsv(rows.map((r) => {
      const d = draftOf(r.id);
      const price = Math.round(Number(d.price.replace(",", ".")) * 100);
      const stock = Number(d.stock);
      return { sku: r.sku, title: r.title, priceKopecks: Number.isFinite(price) && price > 0 ? price : r.priceKopecks, quantity: Number.isInteger(stock) && stock >= 0 ? stock : r.quantity };
    }));
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tovary.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importCsv(file: File) {
    const { rows: parsed, errors } = parseCsv(await file.text());
    const bySku = new Map(rows.map((r) => [r.sku, r]));
    const unknown = parsed.filter((item) => !bySku.has(item.sku)).map((item) => item.sku);
    const known = parsed.filter((item) => bySku.has(item.sku));
    setDrafts((prev) => {
      const next = { ...prev };
      for (const item of known) {
        const r = bySku.get(item.sku);
        if (!r) continue;
        const base = next[r.id] ?? initial[r.id];
        next[r.id] = {
          price: item.priceRub !== undefined ? String(item.priceRub) : base.price,
          stock: item.stockQuantity !== undefined ? String(item.stockQuantity) : base.stock,
        };
      }
      return next;
    });
    setProblems([...errors, ...unknown.slice(0, 20).map((sku) => `код ${sku}: такого товара нет в вашем каталоге`)]);
    setMessage(`Из файла подставлено строк: ${known.length}. Проверьте таблицу и нажмите «Сохранить».`);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function save() {
    if (changed.length === 0) { setMessage("Нет изменений"); return; }
    setBusy(true); setMessage(""); setProblems([]);
    try {
      const items = changed.map((r) => {
        const d = draftOf(r.id);
        const item: { id: string; priceRub?: number; stockQuantity?: number } = { id: r.id };
        if (d.price !== initial[r.id].price) item.priceRub = Number(d.price.replace(",", "."));
        if (d.stock !== initial[r.id].stock) item.stockQuantity = Number(d.stock);
        return item;
      });
      const response = await fetch("/api/seller/products/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const json = (await response.json().catch(() => ({}))) as { error?: string; updated?: number; skipped?: { title: string; reason: string }[] };
      if (!response.ok) throw new Error(json.error ?? "Не удалось сохранить");
      setMessage(`Сохранено товаров: ${json.updated ?? 0}`);
      setProblems((json.skipped ?? []).map((s) => `${s.title}: ${s.reason}`));
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!verified && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Пока магазин не прошёл проверку, можно менять остатки и цены черновиков. Цены товаров в продаже станут доступны после проверки.
        </p>
      )}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm"><span className="mb-1 block">Поиск</span><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название или код" /></label>
        <label className="text-sm"><span className="mb-1 block">Цена выбранных, %</span><input className="input w-28" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="+10 или -5" /></label>
        <button type="button" className="btn btn-ghost" onClick={applyPercent} disabled={selected.size === 0}>Применить %</button>
        <label className="text-sm"><span className="mb-1 block">Остаток выбранных</span><input className="input w-28" inputMode="numeric" value={stockAll} onChange={(e) => setStockAll(e.target.value)} placeholder="шт." /></label>
        <button type="button" className="btn btn-ghost" onClick={applyStock} disabled={selected.size === 0}>Проставить</button>
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost" onClick={exportCsv}>Скачать CSV</button>
        <label className="btn btn-ghost cursor-pointer">Загрузить CSV<input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); }} /></label>
      </div>
      <p className="text-xs text-ink-faint">CSV: столбцы «Код;Название;Цена;Остаток». Пустая ячейка значит «не менять». Скидки ставятся только в «Акциях».</p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-surface-line bg-surface-muted text-xs text-ink-faint">
            <tr>
              <th className="p-3"><input type="checkbox" aria-label="Выбрать все" checked={visible.length > 0 && selected.size === visible.length} onChange={toggleAll} /></th>
              <th className="p-3">Товар</th><th className="p-3">Статус</th><th className="p-3">Цена, ₽</th><th className="p-3">Остаток, шт.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-line">
            {visible.map((r) => {
              const d = draftOf(r.id);
              const dirty = d.price !== initial[r.id].price || d.stock !== initial[r.id].stock;
              const promo = onPromo(r);
              const priceLocked = promo || (!verified && r.status === "ACTIVE");
              return (
                <tr key={r.id} className={dirty ? "bg-amber-50" : undefined}>
                  <td className="p-3"><input type="checkbox" aria-label={`Выбрать ${r.title}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="p-3"><div className="font-medium text-ink">{r.title}</div><div className="text-xs text-ink-faint">Код: {r.sku}</div></td>
                  <td className="p-3 text-xs">{STATUS_RU[r.status] ?? r.status}{promo && <span className="chip ml-1 bg-red-50 text-red-700">скидка</span>}</td>
                  <td className="p-3">
                    <input className="input w-28" inputMode="decimal" value={d.price} disabled={priceLocked} title={promo ? "Идёт скидка: сначала верните обычную цену в «Акциях»" : priceLocked ? "Доступно после проверки магазина" : undefined} onChange={(e) => setDraft(r.id, { price: e.target.value })} />
                  </td>
                  <td className="p-3"><input className="input w-24" inputMode="numeric" value={d.stock} onChange={(e) => setDraft(r.id, { stock: e.target.value })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-ink-faint">Товаров пока нет. Добавьте их на странице «Товары».</p>}
      </div>

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border border-surface-line bg-white p-3 shadow">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || changed.length === 0}>{busy ? "Сохраняю…" : `Сохранить (${changed.length})`}</button>
        {changed.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setDrafts(initial)} disabled={busy}>Отменить изменения</button>}
        <span className="text-sm text-ink-soft" role="status" aria-live="polite">{message}</span>
      </div>
      {problems.length > 0 && (
        <div className="card p-4 text-sm" role="alert">
          <p className="mb-2 font-medium text-amber-800">Не всё применено:</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
