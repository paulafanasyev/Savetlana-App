import type { Metadata } from "next";
import { Suspense } from "react";
import { listCatalog } from "@/lib/domains/catalog-listing";
import { recordEvent } from "@/lib/domains/events";
import { CatalogClient, type CatalogInitial } from "./CatalogClient";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/**
 * Поисковые запросы и фильтр по городу не индексируем: иначе поисковик наберёт
 * тысячи почти одинаковых страниц. Сам каталог и разделы индексируются.
 */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = one(sp.q);
  const city = one(sp.city);
  const category = one(sp.category);
  if (q || city) {
    return {
      title: q ? `Поиск: ${q.slice(0, 60)}` : `Товары из г. ${city.slice(0, 40)}`,
      robots: { index: false, follow: true },
    };
  }
  if (category) {
    return { alternates: { canonical: `/catalog?category=${encodeURIComponent(category)}` } };
  }
  return {};
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const category = one(sp.category);
  const city = one(sp.city);
  // Товары приходят сразу в HTML: их видят поисковики и покупатель без ожидания.
  // Если сервер не справился, страница догрузит выдачу сама, как раньше.
  let initial: CatalogInitial | null = null;
  try {
    const listing = await listCatalog({ q, category, city }, "ssr-catalog");
    initial = {
      key: `${q}|${category}|${city}`,
      items: listing.items,
      corrected: typeof listing.corrected === "string" && listing.corrected ? listing.corrected : null,
    };
    if (q) {
      await recordEvent({
        type: "SEARCH",
        payload: { query: listing.query, mode: listing.mode, count: listing.items.length, corrected: listing.corrected },
        anonymous: true,
      }).catch(() => {});
    }
  } catch {
    initial = null;
  }
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-soft">Загрузка каталога…</div>}>
      <CatalogClient initial={initial} />
    </Suspense>
  );
}
