"use client";

import Link from "next/link";
import { useState } from "react";

interface Category { id: string; name: string; slug: string }
interface Item {
  title: string;
  description: string;
  priceRub?: number;
  categorySlug: string;
  keywords: string[];
  attributes: Record<string, string>;
  exists?: boolean;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/seller/products/compose-bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? "Сервер не ответил. Попробуйте ещё раз.");
  return data;
}

/** «Много карточек из списка»: по товару на строку, черновики после проверки. */
export function BulkProductCompose({ categories }: { categories: Category[] }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: { title: string; reason: string }[] } | null>(null);
  const categoryName = new Map(categories.map((c) => [c.slug, c.name]));

  const parse = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const data = (await post({ text })) as { items: Item[] };
      if (data.items.length === 0) throw new Error("Не нашла ни одного товара. Пишите по товару на строку.");
      setItems(data.items);
      setChosen(data.items.map((i) => !i.exists && i.title.length >= 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось разобрать список");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!items) return;
    setBusy(true); setError(null);
    try {
      const picked = items
        .filter((_, i) => chosen[i])
        .map((i) => ({ title: i.title, description: i.description, priceRub: i.priceRub, categorySlug: i.categorySlug, keywords: i.keywords, attributes: i.attributes }));
      const data = (await post({ items: picked })) as { created: number; skipped: { title: string; reason: string }[] };
      setResult(data);
      setItems(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось создать черновики");
    } finally {
      setBusy(false);
    }
  };

  const count = chosen.filter(Boolean).length;

  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Много карточек из списка</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Вставьте список, по одному товару на строку: что это, бренд, размер или цвет, цена. Например:
          «Кружка керамическая 350 мл, белая, 450 ₽». Светлана разложит каждую строку по полям и покажет,
          что получилось. Черновики создаются только после вашей проверки, до 50 за раз.
        </p>
      </div>
      {!items && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={20000} className="input w-full" aria-label="Список товаров" />
          <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 5} onClick={() => void parse()}>
            {busy ? "Светлана разбирает…" : "Разобрать список"}
          </button>
        </>
      )}
      {items && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li key={`${item.title}-${i}`} className="rounded-lg border border-surface-line p-3 text-sm">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen[i] ?? false}
                    disabled={item.title.length < 3}
                    onChange={(e) => setChosen(chosen.map((c, j) => (j === i ? e.target.checked : c)))}
                  />
                  <span className="min-w-0 flex-1">
                    <b className="text-ink">{item.title || "без названия"}</b>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {item.priceRub ? `${item.priceRub.toLocaleString("ru-RU")} ₽` : "цена не указана"}
                      {" · "}
                      {item.categorySlug ? categoryName.get(item.categorySlug) ?? item.categorySlug : "категория не определена"}
                      {Object.keys(item.attributes).length > 0 && ` · ${Object.entries(item.attributes).map(([k, v]) => `${k}: ${v}`).join(", ")}`}
                    </span>
                    {item.exists && <span className="mt-1 block text-xs text-amber-700">Товар с таким названием у вас уже есть, второй раз не создадим.</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || count === 0} onClick={() => void create()}>
              {busy ? "Создаю черновики…" : `Создать черновики (${count})`}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setItems(null)}>
              Исправить список
            </button>
          </div>
          <p className="text-xs text-ink-faint">Цену, категорию, фото и остаток можно поправить у каждого черновика в разделе «Товары». Без фото и остатка товар не опубликуется.</p>
        </div>
      )}
      {result && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-ink" role="status">
          Создано черновиков: {result.created}.
          {result.skipped.length > 0 && ` Пропущено: ${result.skipped.length} (${result.skipped.slice(0, 3).map((s) => `«${s.title}»: ${s.reason}`).join("; ")}).`}{" "}
          <Link href="/seller/products" className="underline">Перейти к товарам</Link>
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </section>
  );
}
