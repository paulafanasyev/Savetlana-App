"use client";

import { useState } from "react";
import { IMPORT_MAX_ITEMS, type ImportItem, type ParseResult } from "@/lib/catalog-import-parse";

interface Business {
  id: number;
  name: string;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/seller/products/import/yandex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
  return data;
}

/** Пояснение об остатках для экрана проверки. Чистая функция. */
export function stockSummary(items: ImportItem[], stocksLoaded: boolean): string {
  const withStock = items.filter((i) => i.quantity !== undefined).length;
  if (!stocksLoaded || withStock === 0) return "Яндекс Маркет, по ключу. Остатки Маркет не отдал: наличие укажете сами перед публикацией";
  if (withStock === items.length) return "Яндекс Маркет, по ключу. Остатки со своего склада получены для всех товаров";
  return `Яндекс Маркет, по ключу. Остатки со своего склада получены для ${withStock} из ${items.length} товаров, у остальных наличие укажете сами`;
}

/**
 * Перенос с Маркета по ключу API. Ключ хранится только в этой форме и
 * стирается сразу после загрузки товаров.
 */
export function YandexMarketConnect({ disabled, onLoaded }: { disabled: boolean; onLoaded: (res: ParseResult) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (businessId: number) => {
    setError(null);
    const items: ImportItem[] = [];
    const problems: string[] = [];
    let pageToken: string | null = null;
    let stocksLoaded = false;
    try {
      for (let guard = 0; guard < 200; guard++) {
        setBusy(`Загружаем с Маркета: ${items.length}…`);
        const page = (await post({ apiKey, businessId, pageToken })) as { items: ImportItem[]; problems: string[]; nextPageToken: string | null; stocksLoaded?: boolean };
        items.push(...page.items);
        if (page.stocksLoaded) stocksLoaded = true;
        problems.push(...page.problems);
        if (!page.nextPageToken || items.length > IMPORT_MAX_ITEMS) break;
        pageToken = page.nextPageToken;
      }
      setApiKey("");
      setBusinesses(null);
      onLoaded({
        items,
        problems: problems.map((reason, i) => ({ row: i + 1, reason })),
        columns: {},
        format: "table",
        source: stockSummary(items, stocksLoaded),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить товары с Маркета");
    } finally {
      setBusy(null);
    }
  };

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("Подключаемся к Маркету…");
    try {
      const data = (await post({ apiKey })) as { businesses: Business[] };
      if (data.businesses.length === 0) throw new Error("У этого ключа нет ни одного магазина на Маркете.");
      if (data.businesses.length === 1) {
        await load(data.businesses[0].id);
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
      <h2 className="text-base font-bold text-ink">Или напрямую с Яндекс Маркета, без файла</h2>
      <p className="text-ink-soft">
        В кабинете продавца Маркета откройте «Настройки» → «API и модули» и создайте токен (Api-Key) с доступом к просмотру каталога товаров. Вставьте его сюда. Мы не сохраняем ключ: он нужен только на время загрузки, после неё его можно удалить в кабинете Маркета.
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={connect}>
        <input
          type="password"
          className="input min-w-0 flex-1"
          placeholder="Ключ API Маркета"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          disabled={disabled || Boolean(busy)}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button className="btn btn-primary" disabled={disabled || Boolean(busy) || apiKey.trim().length < 10}>
          Загрузить товары
        </button>
      </form>
      {businesses && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="market-business" className="text-ink">Какой кабинет переносим:</label>
          <select id="market-business" className="input w-auto" value={chosen ?? ""} onChange={(e) => setChosen(Number(e.target.value))}>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn btn-primary" disabled={Boolean(busy) || chosen === null} onClick={() => chosen !== null && void load(chosen)}>
            Загрузить
          </button>
        </div>
      )}
      {busy && <p className="text-ink-soft">{busy}</p>}
      {error && <div className="rounded-xl bg-red-50 p-3 text-bad" role="alert">{error}</div>}
      <p className="text-xs text-ink-faint">Остатки берём только со своего склада (FBS, DBS, Экспресс), товар на складе Маркета не считаем. Если складов несколько, берём наибольший остаток одного склада, а не сумму. Наличие вы всё равно подтвердите у нас перед публикацией.</p>
    </div>
  );
}
