import { searchProducts, type SearchFilters } from "./catalog";
import { ensureDemoShipCities, shipCitiesBySeller } from "./seller-ship-from";
import { isDemoSeller } from "./seller-trust-display";
import { resolveShipCity } from "../ship-from";
import { newTraceId } from "../ai/gateway";
import { prisma } from "../prisma";

/** Параметры выдачи каталога в том виде, в каком они приходят из адресной строки. */
export interface CatalogQuery {
  q?: string;
  category?: string;
  city?: string | null;
  maxPrice?: number;
  minPrice?: number;
  minRating?: number;
  availabilityOnly?: boolean;
  sort?: SearchFilters["sort"];
  limit?: number;
  offset?: number;
}

export interface CatalogListItem {
  id: string;
  title: string;
  slug: string | null;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  rating: number;
  reviewsCount: number;
  seller: { id: string; name: string; demo: boolean };
  shipCity: string | null;
  availability: string;
  imageUrl: string | null;
  signals: string[];
}

/**
 * Одна выдача для API и для серверной страницы каталога: поисковик должен
 * видеть те же товары, что и покупатель, без JavaScript.
 */
export async function listCatalog(input: CatalogQuery, traceTag = "catalog") {
  // Демо-магазинам один раз проставляем город отгрузки; ошибка не ломает поиск.
  await ensureDemoShipCities().catch(() => {});
  // Город только из справочника: неизвестное название не фильтрует, а не обнуляет выдачу.
  const city = resolveShipCity(input.city ?? null)?.name;
  const filters: SearchFilters = {
    query: input.q || undefined,
    categorySlug: input.category || undefined,
    maxPrice: input.maxPrice,
    minPrice: input.minPrice,
    minRating: input.minRating,
    availabilityOnly: input.availabilityOnly ?? false,
    shipCity: city,
    sort: input.sort ?? "relevance",
    limit: input.limit,
    offset: input.offset,
  };
  const { results, total, mode, corrected } = await searchProducts(filters, newTraceId(traceTag));
  const ids = results.map((r) => r.product.id);
  const sellerIds = [...new Set(results.map((r) => r.product.sellerProfile.id))];
  const [images, shipCities, sellerSlugs] = await Promise.all([
    ids.length
      ? prisma.productImage.findMany({ where: { productId: { in: ids } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { productId: true, url: true } })
      : Promise.resolve([] as { productId: string; url: string }[]),
    shipCitiesBySeller(sellerIds).catch(() => new Map<string, string>()),
    // Демо-магазины честно помечаем и в выдаче, не только на их странице.
    sellerIds.length
      ? prisma.sellerProfile.findMany({ where: { id: { in: sellerIds } }, select: { id: true, slug: true } }).catch(() => [] as { id: string; slug: string }[])
      : Promise.resolve([] as { id: string; slug: string }[]),
  ]);
  const demoSellers = new Set(sellerSlugs.filter((s) => isDemoSeller({ slug: s.slug })).map((s) => s.id));
  const firstImage = new Map<string, string>();
  for (const image of images) if (!firstImage.has(image.productId)) firstImage.set(image.productId, image.url);
  const items: CatalogListItem[] = results.map((r) => ({
    id: r.product.id,
    title: r.product.title,
    slug: r.product.seoSlug ?? null,
    priceKopecks: r.product.priceKopecks,
    oldPriceKopecks: r.product.oldPriceKopecks ?? null,
    rating: r.product.rating,
    reviewsCount: r.product.reviewsCount,
    seller: { id: r.product.sellerProfile.id, name: r.product.sellerProfile.displayName, demo: demoSellers.has(r.product.sellerProfile.id) },
    shipCity: shipCities.get(r.product.sellerProfile.id) ?? null,
    availability: r.product.inventory?.availability ?? "UNKNOWN",
    imageUrl: firstImage.get(r.product.id) ?? null,
    signals: r.signals,
  }));
  return { total, mode, city: city ?? null, corrected, query: filters.query, items };
}
