"use client";

export const dynamic = "force-dynamic";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { rub, availabilityLabel, countText, REVIEW_FORMS } from "@/lib/format";
import { readCityCookie } from "@/lib/my-city";
import { SvetlanaChat } from "@/components/SvetlanaChat";

interface CatalogItem {
  id: string;
  title: string;
  priceKopecks: number;
  rating: number;
  reviewsCount: number;
  availability: string;
  seller: { id: string; name: string; demo?: boolean };
  shipCity?: string | null;
  signals: string[];
  imageUrl?: string | null;
}

/** Адрес каталога с теми же запросом и разделом, но с другим городом (или без него). */
function catalogHref(q: string, category: string, city: string): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (category) p.set("category", category);
  if (city) p.set("city", city);
  const s = p.toString();
  return s ? `/catalog?${s}` : "/catalog";
}

function CatalogInner() {
  const params = useSearchParams();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [photo, setPhoto] = useState<VisionResult | null>(null);
  // Запрос с исправленной опечаткой, если поиск его исправил.
  const [corrected, setCorrected] = useState<string | null>(null);
  // useSearchParams() can be null during server rendering.
  const [q, setQ] = useState(params?.get("q") ?? "");
  // «Мой город» живёт в куке браузера, читаем её после загрузки страницы.
  const [myCity, setMyCity] = useState<string | null>(null);

  const query = params?.get("q") ?? "";
  const category = params?.get("category") ?? "";
  const cityParam = params?.get("city") ?? "";

  useEffect(() => {
    setMyCity(readCityCookie(document.cookie));
  }, []);

  useEffect(() => {
    const url = new URL("/api/catalog/search", location.origin);
    if (query) url.searchParams.set("q", query);
    if (category) url.searchParams.set("category", category);
    if (cityParam) url.searchParams.set("city", cityParam);
    setLoading(true);
    setFailed(false);
    void fetch(url.toString())
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setItems(d.items ?? []);
        setCorrected(typeof d.corrected === "string" && d.corrected ? d.corrected : null);
      })
      .catch(() => {
        // A failed request is not the same as "nothing found": say so honestly.
        setItems([]);
        setCorrected(null);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [query, category, cityParam, attempt]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-ink">
        {query ? `Поиск: ${query}` : "Каталог"}
        {cityParam ? <span className="text-base font-medium text-ink-soft"> · из г. {cityParam}</span> : null}
      </h1>

      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          location.assign(catalogHref(q, category, cityParam));
        }}
      >
        <input
          className="input min-w-[12rem] flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Что ищем? Например: ноутбук для учёбы до 100 тысяч"
          aria-label="Поиск"
        />
        <button className="btn btn-primary shrink-0" type="submit">
          Найти
        </button>
        <PhotoSearch onResult={(d) => {
          setPhoto(d);
          setFailed(false);
          setCorrected(null);
          setItems(d.candidates.map((c) => ({
            id: c.productId,
            title: c.title,
            priceKopecks: c.priceKopecks,
            rating: 0,
            reviewsCount: 0,
            availability: c.availability,
            seller: { id: "", name: c.sellerName },
            signals: [`совпадение: ${c.match}`, `схожесть: ${Math.round(c.similarity * 100)}%`],
            imageUrl: null,
          })));
        }} />
      </form>

      <div className="mb-6 text-sm">
        {myCity ? (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={cityParam === myCity}
              onChange={(e) => location.assign(catalogHref(query, category, e.target.checked ? myCity : ""))}
            />
            <span>Только продавцы из г. {myCity}</span>
            <Link href="/city" className="text-xs text-ink-soft underline">другой город</Link>
          </label>
        ) : cityParam ? (
          <Link href={catalogHref(query, category, "")} className="text-ink-soft underline">Показать товары из всех городов</Link>
        ) : (
          <Link href="/city" className="text-ink-soft underline">Укажите свой город, чтобы искать продавцов рядом</Link>
        )}
      </div>

      {photo && (
        <div className={`card mb-6 p-4 text-sm ${photo.status === "MOCK_VERIFIED" ? "bg-amber-50" : "bg-svetlana-50"}`}>
          <div className="font-medium text-ink">{photo.explanation}</div>
          {photo.status === "MOCK_VERIFIED" && (
            <div className="mt-1 text-xs text-amber-800">
              Распознавание работает в тестовом режиме: результат не является
              настоящим анализом фотографии.
            </div>
          )}
          {photo.candidates.length > 0 && (
            <div className="mt-2 text-ink-soft">
              Похожие товары из каталога: {photo.candidates.length}.
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {loading ? (
            <div className="card p-8 text-center text-ink-soft" aria-busy="true">Ищем подходящие варианты…</div>
          ) : failed ? (
            <div className="card p-8 text-center" role="alert">
              <div className="text-lg font-semibold text-ink">Не удалось загрузить каталог</div>
              <p className="mt-2 text-sm text-ink-soft">Проверьте соединение и попробуйте ещё раз.</p>
              <button className="btn btn-primary mt-4" type="button" onClick={() => setAttempt((n) => n + 1)}>
                Повторить
              </button>
            </div>
          ) : items.length === 0 ? (
            cityParam && !photo ? (
              <div className="card p-8 text-center">
                <div className="text-lg font-semibold text-ink">Из г. {cityParam} пока никто не отправляет{query ? " такие товары" : ""}</div>
                <p className="mt-2 text-sm text-ink-soft">Продавцы из других городов доставляют по всей России.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link href={catalogHref(query, category, "")} className="btn btn-primary">Показать все города</Link>
                </div>
              </div>
            ) : query || category || photo ? (
              <div className="card p-8 text-center">
                <div className="text-lg font-semibold text-ink">Ничего не нашлось</div>
                <p className="mt-2 text-sm text-ink-soft">
                  Попробуйте написать короче или другими словами, например «чайник» вместо «электрический чайник из стекла».
                  Или спросите Светлану справа: она подберёт альтернативы.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link href="/catalog" className="btn btn-primary">Весь каталог</Link>
                  <Link href="/gifts" className="btn btn-ghost">Подобрать подарок</Link>
                </div>
              </div>
            ) : (
              <div className="card p-8 text-center">
                <div className="text-lg font-semibold text-ink">В каталоге пока нет товаров</div>
                <p className="mt-2 text-sm text-ink-soft">
                  Продавцы ещё не выставили товары. Загляните чуть позже или станьте первым продавцом: карточку товара можно создать за пару минут вместе со Светланой.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link href="/seller" className="btn btn-primary">Начать продавать</Link>
                  <Link href="/" className="btn btn-ghost">На главную</Link>
                </div>
              </div>
            )
          ) : (
            <>
              {corrected && !photo && (
                <p className="mb-3 rounded-lg bg-svetlana-50 px-3 py-2 text-sm text-ink" role="status" data-testid="search-corrected">
                  Исправили опечатку: показано по запросу «<b>{corrected}</b>».
                </p>
              )}
              <div className="mb-3 text-sm text-ink-soft">Найдено: {items.length}</div>
              {items.some((item) => item.seller.demo) && (
                <p className="mb-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-700" role="note" data-testid="catalog-demo-note">
                  Товары с пометкой «демо» выставила площадка, чтобы показать работу каталога. Их продавцы не проходили проверку.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {items.map((item) => (
                  <Link key={item.id} href={`/product/${item.id}`} className="card overflow-hidden transition-shadow hover:shadow-float">
                    <div className="relative aspect-square bg-surface-muted">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt={item.title} loading="lazy" className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-4xl" aria-hidden>📦</div>
                      )}
                      {item.seller.demo && (
                        <span className="absolute left-2 top-2 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium text-white" data-testid="demo-mark">
                          демо
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5 p-3">
                      <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-ink">
                        {item.title}
                      </div>
                      <div className="text-base font-bold text-svetlana-700">{rub(item.priceKopecks)}</div>
                      <div className="text-xs text-ink-soft">
                        {item.seller.name}
                        {item.seller.demo ? " · демо-магазин" : ""}
                      </div>
                      {item.shipCity && <div className="text-xs text-ink-soft">📍 Отправка из г. {item.shipCity}</div>}
                      <div className="flex items-center gap-1 text-xs text-ink-faint">
                        {item.reviewsCount > 0 ? (
                          <>
                            <span>★ {item.rating.toFixed(1)}</span>
                            <span>·</span>
                            <span>{countText(item.reviewsCount, REVIEW_FORMS)}</span>
                          </>
                        ) : (
                          <span>пока без отзывов</span>
                        )}
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

interface VisionCandidate {
  productId: string;
  title: string;
  priceKopecks: number;
  sellerName: string;
  availability: string;
  similarity: number;
  match: string;
}

interface VisionResult {
  status: string;
  explanation: string;
  candidates: VisionCandidate[];
}

/**
 * Photo search entry point (spec §6). Uploads an image to the vision pipeline
 * and surfaces the result, including the honest test-mode warning when the
 * recognition is not from a real model.
 */
function PhotoSearch({ onResult }: { onResult: (d: VisionResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch("/api/vision/search", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось распознать фотографию.");
        return;
      }
      onResult(data as VisionResult);
    } catch {
      setError("Не удалось загрузить фотографию. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        id="photo-search-input"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <label
        htmlFor="photo-search-input"
        className="btn btn-ghost inline-flex cursor-pointer items-center gap-2"
        title="Найти товар по фотографии"
      >
        <span aria-hidden>📷</span>
        <span className="hidden sm:inline">{busy ? "Распознаём…" : "По фото"}</span>
      </label>
      {error && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-surface-line bg-white p-3 text-xs text-bad shadow-float" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
