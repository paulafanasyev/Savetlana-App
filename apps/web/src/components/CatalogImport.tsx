"use client";

import Link from "next/link";
import { useState } from "react";
import { FIELD_LABELS, IMPORT_MAX_ITEMS, parseCatalogFile, type ImportItem, type ParseResult } from "@/lib/catalog-import-parse";
import { ImportPhotoCopy } from "@/components/ImportPhotoCopy";
import { YandexMarketConnect } from "@/components/YandexMarketConnect";

const CHUNK = 100;

interface Update {
  title: string;
  priceFromRub?: number;
  priceToRub?: number;
  stockFrom?: number;
  stockTo?: number;
}

interface Outcome {
  created: number;
  wouldCreate: number;
  updated: number;
  wouldUpdate: number;
  unchanged: number;
  updates: Update[];
  skipped: { title: string; reason: string }[];
  preview: { title: string; priceRub: number; quantity: number | null; images: number }[];
}

async function sendChunks(items: ImportItem[], dryRun: boolean, onProgress: (done: number) => void): Promise<Outcome> {
  const total: Outcome = { created: 0, wouldCreate: 0, updated: 0, wouldUpdate: 0, unchanged: 0, updates: [], skipped: [], preview: [] };
  for (let i = 0; i < items.length; i += CHUNK) {
    const res = await fetch("/api/seller/products/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.slice(i, i + CHUNK), dryRun }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз через минуту.");
    total.created += data.created;
    total.wouldCreate += data.wouldCreate;
    total.updated += data.updated ?? 0;
    total.wouldUpdate += data.wouldUpdate ?? 0;
    total.unchanged += data.unchanged ?? 0;
    if (total.updates.length < 10) total.updates.push(...(data.updates ?? []).slice(0, 10 - total.updates.length));
    total.skipped.push(...data.skipped);
    if (total.preview.length < 10) total.preview.push(...data.preview.slice(0, 10 - total.preview.length));
    onProgress(Math.min(i + CHUNK, items.length));
  }
  return total;
}

function rubles(value: number): string {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

export function CatalogImport() {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [check, setCheck] = useState<Outcome | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    setParsed(null); setCheck(null); setResult(null); setError(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 30 * 1024 * 1024) { setError("Файл больше 30 МБ. Разделите его на несколько частей."); return; }
    setBusy("Читаем файл…");
    try {
      await review(await parseCatalogFile(file.name, await file.arrayBuffer()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
    }
  };

  /** Общая проверка товаров: из файла или с Маркета по ключу. */
  const review = async (res: ParseResult) => {
    setParsed(res);
    if (res.items.length > IMPORT_MAX_ITEMS) { setError(`Товаров ${res.items.length}, за раз можно до ${IMPORT_MAX_ITEMS}. Разделите файл.`); return; }
    if (res.items.length > 0) {
      setBusy("Проверяем товары…");
      setCheck(await sendChunks(res.items, true, () => undefined));
    }
  };

  const onMarket = async (res: ParseResult) => {
    setParsed(null); setCheck(null); setResult(null); setError(null);
    setFileName("Яндекс Маркет");
    try {
      await review(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить товары");
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!parsed) return;
    setError(null);
    setBusy(`Загружаем: 0 из ${parsed.items.length}`);
    try {
      setResult(await sendChunks(parsed.items, false, (done) => setBusy(`Загружаем: ${done} из ${parsed.items.length}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить товары");
    } finally {
      setBusy(null);
    }
  };

  if (result) {
    return (
      <div className="card space-y-3 p-6">
        <h2 className="text-lg font-bold text-ink">Готово: добавлено {result.created}, обновлено {result.updated}</h2>
        {result.created > 0 && (
          <p className="text-sm text-ink-soft">
            Новые товары пока не видны покупателям. Проверьте карточки, подтвердите наличие и опубликуйте их.
          </p>
        )}
        {result.updated > 0 && <p className="text-sm text-ink-soft">У уже перенесённых товаров обновлены цены и остатки, изменения записаны в журнал товара.</p>}
        {result.skipped.length > 0 && <SkippedList skipped={result.skipped} />}
        {result.created > 0 && <ImportPhotoCopy autoStart />}
        <div className="flex flex-wrap gap-2">
          <Link href="/seller/products" className="btn btn-primary">К товарам</Link>
          <button className="btn btn-ghost" onClick={() => { setResult(null); setParsed(null); setCheck(null); setFileName(""); }}>Загрузить ещё файл</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-6 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Откуда взять файл</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-ink">Яндекс Маркет:</b> в кабинете продавца, в разделе «Товары», скачайте каталог в Excel (.xlsx). Лист с инструкцией не мешает: товары найдём сами. Если у магазина есть свой сайт, подойдёт и его фид YML.</li>
          <li><b className="text-ink">Ozon и Wildberries:</b> в личном кабинете, в разделе с товарами, скачайте список товаров в Excel (.xlsx).</li>
          <li><b className="text-ink">1С и учётные программы:</b> сохраните прайс-лист или список номенклатуры в Excel (.xlsx) или CSV.</li>
          <li><b className="text-ink">Сайт на InSales, Тильде, Битриксе и других:</b> подойдёт фид для Яндекс Маркета (YML, .xml).</li>
        </ul>
        <p>Нужны хотя бы колонки с названием и ценой. Артикул, описание, остаток, фото, бренд и штрихкод подхватим, если они есть.</p>
      </div>

      <YandexMarketConnect disabled={Boolean(busy)} onLoaded={(res) => void onMarket(res)} />

      <ImportPhotoCopy />

      <div className="card space-y-4 p-6">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink">Файл с товарами</span>
          <input type="file" accept=".xlsx,.csv,.txt,.xml,.yml" className="block w-full text-sm" disabled={Boolean(busy)} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {busy && <p className="text-sm text-ink-soft">{busy}</p>}
        {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-bad" role="alert">{error}</div>}

        {parsed && (
          <div className="space-y-3 text-sm">
            <p className="text-ink">
              {fileName === "Яндекс Маркет" ? "На Маркете" : <>В файле «{fileName}»</>} нашли товаров: <b>{parsed.items.length}</b>
              {parsed.problems.length > 0 && <>, не разобрали строк: <b>{parsed.problems.length}</b></>}.
            </p>
            {(parsed.source || parsed.sheet) && (
              <p className="text-ink-soft">
                {parsed.source && <>Похоже на выгрузку: {parsed.source}. </>}
                {parsed.sheet && <>Товары взяли с листа «{parsed.sheet}».</>}
              </p>
            )}
            {Object.keys(parsed.columns).length > 0 && (
              <p className="text-ink-soft">
                Узнали колонки: {Object.entries(parsed.columns).map(([f, h]) => `${FIELD_LABELS[f as keyof typeof FIELD_LABELS]} ← «${h}»`).join(", ")}.
              </p>
            )}
            {parsed.problems.length > 0 && (
              <details className="text-ink-soft">
                <summary className="cursor-pointer">Что не разобрали</summary>
                <ul className="mt-2 list-disc pl-5">
                  {parsed.problems.slice(0, 20).map((p, i) => <li key={i}>Строка {p.row}: {p.reason}</li>)}
                  {parsed.problems.length > 20 && <li>и ещё {parsed.problems.length - 20}</li>}
                </ul>
              </details>
            )}
          </div>
        )}

        {check && (
          <div className="space-y-3 text-sm">
            {check.preview.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-xs text-ink-faint"><tr><th className="py-1 pr-3">Название</th><th className="py-1 pr-3">Цена</th><th className="py-1 pr-3">Остаток</th><th className="py-1">Фото</th></tr></thead>
                  <tbody className="divide-y divide-surface-line">
                    {check.preview.map((p, i) => (
                      <tr key={i}><td className="py-1 pr-3 text-ink">{p.title}</td><td className="py-1 pr-3">{rubles(p.priceRub)}</td><td className="py-1 pr-3">{p.quantity ?? "—"}</td><td className="py-1">{p.images}</td></tr>
                    ))}
                  </tbody>
                </table>
                {check.wouldCreate > check.preview.length && <p className="mt-1 text-xs text-ink-faint">Показаны первые {check.preview.length} из {check.wouldCreate}.</p>}
              </div>
            )}
            {check.wouldUpdate > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 font-medium text-ink">Уже есть в магазине, обновим: {check.wouldUpdate}</p>
                <table className="w-full text-left">
                  <thead className="text-xs text-ink-faint"><tr><th className="py-1 pr-3">Товар</th><th className="py-1 pr-3">Цена</th><th className="py-1">Остаток</th></tr></thead>
                  <tbody className="divide-y divide-surface-line">
                    {check.updates.map((u, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-3 text-ink">{u.title}</td>
                        <td className="py-1 pr-3">{u.priceToRub !== undefined && u.priceFromRub !== undefined ? `${rubles(u.priceFromRub)} → ${rubles(u.priceToRub)}` : "без изменений"}</td>
                        <td className="py-1">{u.stockTo !== undefined ? `${u.stockFrom ?? 0} → ${u.stockTo}` : "без изменений"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {check.wouldUpdate > check.updates.length && <p className="mt-1 text-xs text-ink-faint">Показаны первые {check.updates.length} из {check.wouldUpdate}.</p>}
              </div>
            )}
            {check.unchanged > 0 && <p className="text-ink-soft">Без изменений: {check.unchanged}.</p>}
            {check.skipped.length > 0 && <SkippedList skipped={check.skipped} />}
            {check.wouldCreate + check.wouldUpdate > 0 ? (
              <button className="btn btn-primary" disabled={Boolean(busy)} onClick={runImport}>
                {[check.wouldCreate > 0 ? `Добавить ${check.wouldCreate}` : "", check.wouldUpdate > 0 ? `обновить ${check.wouldUpdate}` : ""].filter(Boolean).join(" и ").replace(/^о/, "О")}
              </button>
            ) : (
              <p className="text-ink-soft">Всё уже совпадает с файлом, менять нечего.</p>
            )}
            <p className="text-xs text-ink-faint">Новые товары появятся черновиками и не будут видны покупателям, пока вы их не опубликуете. Повторная загрузка не создаёт дублей: у уже перенесённых товаров обновляются цена и остаток. Скидки из файла не переносятся на опубликованные товары, ими управляет раздел «Акции».</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SkippedList({ skipped }: { skipped: { title: string; reason: string }[] }) {
  return (
    <details className="text-sm text-ink-soft">
      <summary className="cursor-pointer">Пропущено: {skipped.length}</summary>
      <ul className="mt-2 list-disc pl-5">
        {skipped.slice(0, 30).map((s, i) => <li key={i}>«{s.title}»: {s.reason}</li>)}
        {skipped.length > 30 && <li>и ещё {skipped.length - 30}</li>}
      </ul>
    </details>
  );
}
