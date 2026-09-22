"use client";

export const dynamic = "force-dynamic";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { rub, availabilityLabel } from "@/lib/format";
import { SvetlanaChat } from "@/components/SvetlanaChat";

interface CatalogItem {
  id: string;
  title: string;
  priceKopecks: number;
  rating: number;
  reviewsCount: number;
  availability: string;
  seller: { id: string; name: string };
  signals: string[];
}

function CatalogInner() {
  const params = useSearchParams();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  // useSearchParams() can be null during server rendering.
  const [q, setQ] = useState(params?.get("q") ?? "");

  const query = params?.get("q") ?? "";
  const category = params?.get("category") ?? "";

  useEffect(() => {
    const url = new URL("/api/catalog/search", location.origin);
    if (query) url.searchParams.set("q", query);
    if (category) url.searchParams.set("category", category);
    setLoading(true);
    void fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [query, category]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">
        Каталог{category ? ` · ${category}` : ""}
      </h1>

      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const u = new URL(location.pathname, location.origin);
          if (q) u.searchParams.set("q", q);
          if (category) u.searchParams.set("category", category);
          location.assign(u.toString());
        }}
      >
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Что ищем? Например: ноутбук для учёбы до 100 тысяч"
          aria-label="Поиск"
        />
        <button className="btn btn-primary shrink-0" type="submit">
          Найти
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {loading ? (
            <div className="card p-8 text-center text-ink-soft">Ищем подходящие варианты…</div>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-lg font-semibold text-ink">Ничего не нашлось</div>
              <p className="mt-2 text-sm text-ink-soft">
                Переформулируйте запрос или спросите Светлану — она подберёт альтернативы.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 text-sm text-ink-soft">Найдено: {items.length}</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {items.map((item) => (
                  <Link key={item.id} href={`/product/${item.id}`} className="card overflow-hidden transition-shadow hover:shadow-float">
                    <div className="space-y-1.5 p-3">
                      <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-ink">
                        {item.title}
                      </div>
                      <div className="text-base font-bold text-svetlana-700">{rub(item.priceKopecks)}</div>
                      <div className="text-xs text-ink-soft">{item.seller.name}</div>
                      <div className="flex items-center gap-1 text-xs text-ink-faint">
                        <span>★ {item.rating.toFixed(1)}</span>
                        <span>·</span>
                        <span>{item.reviewsCount} отз.</span>
                      </div>
                      <div className="text-xs">{availabilityLabel(item.availability)}</div>
                      {item.signals[0] && (
                        <div className="mt-1 line-clamp-1 text-[11px] text-ink-faint">Почему это: {item.signals[0]}</div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <SvetlanaChat side="buyer" />
        </div>
      </div>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-soft">Загрузка каталога…</div>}>
      <CatalogInner />
    </Suspense>
  );
}
