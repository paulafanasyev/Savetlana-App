"use client";

import { useState } from "react";

interface Business {
  id: number;
  name: string;
}

interface Change {
  title: string;
  from: number;
  to: number;
}

interface Batch {
  stocksLoaded: boolean;
  checked: number;
  changes: Change[];
  updated: number;
  notOnMarket: number;
  unchanged: number;
  skipped: { title: string; reason: string }[];
  nextCursor: string | null;
}

interface Totals {
  checked: number;
  changes: Change[];
  updated: number;
  notOnMarket: number;
  unchanged: number;
  skipped: { title: string; reason: string }[];
}

async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
  return data;
}

/**
 * «Обновить остатки с Маркета» для уже перенесённых товаров. Ключ живёт
 * только в этой форме и стирается, когда остатки обновлены.
 */
export function MarketStockSync() {
  const [apiKey, setApiKey] = useState("");
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [preview, setPreview] = useState<Totals | null>(null);
  const [done, setDone] = useState<Totals | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (businessId: number, dryRun: boolean): Promise<Totals | null> => {
    const totals: Totals = { checked: 0, changes: [], updated: 0, notOnMarket: 0, unchanged: 0, skipped: [] };
    let cursor: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      setBusy(dryRun ? `Сверяем остатки: ${totals.checked}…` : `Обновляем остатки: ${totals.updated}…`);
      const batch = (await post("/api/seller/products/import/yandex/stocks", { apiKey, businessId, cursor, dryRun })) as Batch;
      if (!batch.stocksLoaded) {
        throw new Error("Маркет не отдал остатки. Проверьте, что у ключа есть доступ к остаткам и что магазин работает со своего склада (FBS, DBS или Экспресс).");
      }
      totals.checked += batch.checked;
      totals.changes.push(...batch.changes);
      totals.updated += batch.updated;
      totals.notOnMarket += batch.notOnMarket;
      totals.unchanged += batch.unchanged;
      totals.skipped.push(...batch.skipped);
      if (!batch.nextCursor) break;
      cursor = batch.nextCursor;
    }
    return totals;
  };

  const check = async (businessId: number) => {
    setError(null);
    setDone(null);
    try {
      const totals = await run(businessId, true);
      setChosen(businessId);
      setPreview(totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сверить остатки");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (chosen === null) return;
    setError(null);
    try {
      const totals = await run(chosen, false);
      setDone(totals);
      setPreview(null);
      setApiKey("");
      setBusinesses(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить остатки");
    } finally {
      setBusy(null);
    }
  };

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPreview(null);
    setDone(null);
    setBusy("Подключаемся к Маркету…");
    try {
      const data = (await post("/api/seller/products/import/yandex", { apiKey })) as { businesses: Business[] };
      if (data.businesses.length === 0) throw new Error("У этого ключа нет ни одного магазина на Маркете.");
      if (data.businesses.length === 1) {
        await check(data.businesses[0].id);
        return;
      }
      setBusinesses(data.businesses);
      setChosen(data.businesses[0].id);
      setBusy(null);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Не удалось подключиться к Маркету");
      setBusy(null);
    }
  };

  return (
    <div className="card space-y-3 p-6 text-sm">
      <h2 className="text-base font-bold text-ink">Обновить остатки с Яндекс Маркета</h2>
      <p className="text-ink-soft">
        Для товаров, которые вы уже перенесли. Меняем только остаток, цену не трогаем. Сначала покажем, что изменится, и обновим только после вашего подтверждения. Ключ не сохраняем, поэтому само по расписанию обновление не идёт: нажимайте, когда нужно.
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={connect}>
        <input
          type="password"
          className="input min-w-0 flex-1"
          placeholder="Ключ API Маркета"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          disabled={Boolean(busy)}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button className="btn btn-primary" disabled={Boolean(busy) || apiKey.trim().length < 10}>
          Сверить остатки
        </button>
      </form>
      {businesses && !preview && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="stock-business" className="text-ink">Кабинет Маркета:</label>
          <select id="stock-business" className="input w-auto" value={chosen ?? ""} onChange={(e) => setChosen(Number(e.target.value))}>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn btn-primary" disabled={Boolean(busy) || chosen === null} onClick={() => chosen !== null && void check(chosen)}>
            Сверить
          </button>
        </div>
      )}
      {preview && (
        <div className="space-y-2 rounded-xl bg-zinc-50 p-4">
          <p className="text-ink">
            Проверено товаров: {preview.checked}. Изменится остаток: {preview.changes.length}. Совпадает: {preview.unchanged}.
            {preview.notOnMarket > 0 && ` Не нашли на Маркете: ${preview.notOnMarket}, их остаток не трогаем.`}
          </p>
          {preview.changes.length > 0 && (
            <ul className="space-y-1 text-ink-soft">
              {preview.changes.slice(0, 10).map((c, i) => (
                <li key={`${c.title}-${i}`}>«{c.title}»: {c.from} → {c.to} шт.</li>
              ))}
              {preview.changes.length > 10 && <li>и ещё {preview.changes.length - 10}</li>}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {preview.changes.length > 0 && (
              <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void apply()}>
                Обновить остатки
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => { setPreview(null); setApiKey(""); setBusinesses(null); }}>
              {preview.changes.length > 0 ? "Отмена" : "Готово"}
            </button>
          </div>
        </div>
      )}
      {done && (
        <div className="rounded-xl bg-green-50 p-4 text-ink" role="status">
          Обновлено остатков: {done.updated}.{done.skipped.length > 0 && ` Не обновили: ${done.skipped.length} (${done.skipped.slice(0, 3).map((s) => `«${s.title}»: ${s.reason}`).join("; ")}).`}
        </div>
      )}
      {busy && <p className="text-ink-soft">{busy}</p>}
      {error && <div className="rounded-xl bg-red-50 p-3 text-bad" role="alert">{error}</div>}
      <p className="text-xs text-ink-faint">
        Остатки берём только со своего склада (FBS, DBS, Экспресс). Заказы с нашей площадки Маркет не видит: если товар купили здесь, уменьшите остаток и на Маркете, иначе при обновлении он вернётся.
      </p>
    </div>
  );
}
