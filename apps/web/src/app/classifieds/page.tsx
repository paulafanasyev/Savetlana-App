import Link from "next/link";
import { headers } from "next/headers";
import { searchClassifieds, getGeoTree } from "@/lib/domains/classifieds";
import { ensureDemoClassifieds } from "@/lib/domains/demo";
import { prisma } from "@/lib/prisma";
import { DEAL_TYPE_LABELS, VERTICAL_LABELS, dealTypeLabel, verticalEmoji, verticalLabel } from "@/lib/verticals";
import { rub } from "@/lib/format";
import { priceText } from "@/lib/classified-fields";
import { resolveSearchParams } from "@/lib/page-params";
import { readCityCookie } from "@/lib/my-city";
import { normalize, type PickCity } from "@/lib/city-pick";
import { nearbyCities } from "@/lib/nearby";
import { CityFilter } from "./CityFilter";

export const dynamic = "force-dynamic";

const NEARBY_RADIUS_KM = 300;

interface NearbyAd {
  id: string;
  title: string;
  priceKopecks: number;
  vertical: string;
  dealType: string;
  cityName: string;
  km: number;
  cover: string | null;
}

export default async function ClassifiedsPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string; dealType?: string; cityId?: string; q?: string }>;
}) {
  const query = await resolveSearchParams(searchParams);
  // Пустая база: показываем помеченные примеры, пока нет настоящих объявлений.
  await ensureDemoClassifieds();
  const tree = await getGeoTree();

  // Все города одним списком, крупные первыми (для подсказок в фильтре).
  const cities: PickCity[] = tree
    .flatMap((d) => d.regions.flatMap((r) => r.cities.map((c) => ({ id: c.id, name: c.name, regionName: r.name, population: c.population ?? 0 }))))
    .sort((a, b) => b.population - a.population)
    .map(({ id, name, regionName }) => ({ id, name, regionName }));

  // Город в ссылке важнее всего; cityId=all значит «по всей России».
  // Без города в ссылке показываем «мой город», если человек его выбрал.
  let cityId = query.cityId && query.cityId !== "all" ? query.cityId : undefined;
  let myCity: PickCity | null = null;
  if (!query.cityId) {
    const mine = readCityCookie((await headers()).get("cookie"));
    myCity = mine ? cities.find((c) => normalize(c.name) === normalize(mine)) ?? null : null;
    if (myCity) cityId = myCity.id;
  }

  const result = await searchClassifieds({
    vertical: query.vertical,
    dealType: query.dealType,
    cityId,
    query: query.q,
    limit: 30,
  });

  // В моём городе мало объявлений: добавляем соседние города с расстоянием.
  let nearbyAds: NearbyAd[] = [];
  if (myCity && result.items.length < 12) {
    const near = nearbyCities(myCity.name, NEARBY_RADIUS_KM, 12);
    const kmByName = new Map(near.map((n) => [normalize(n.name), n.km]));
    const ids = cities.filter((c) => kmByName.has(normalize(c.name))).map((c) => c.id);
    const q = query.q?.trim();
    if (ids.length) {
      const rows = await prisma.classified.findMany({
        where: {
          status: "PUBLISHED",
          cityId: { in: ids },
          ...(query.vertical ? { vertical: query.vertical } : {}),
          ...(query.dealType ? { dealType: query.dealType } : {}),
          ...(q && q.length >= 2 ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          title: true,
          priceKopecks: true,
          vertical: true,
          dealType: true,
          city: { select: { name: true } },
          images: { select: { url: true }, orderBy: { isCover: "desc" }, take: 1 },
        },
      });
      nearbyAds = rows
        .map((r) => ({
          id: r.id,
          title: r.title,
          priceKopecks: r.priceKopecks,
          vertical: r.vertical,
          dealType: r.dealType,
          cityName: r.city.name,
          km: kmByName.get(normalize(r.city.name)) ?? 0,
          cover: r.images[0]?.url ?? null,
        }))
        .sort((a, b) => a.km - b.km);
    }
  }

  const everywhere = new URLSearchParams();
  if (query.vertical) everywhere.set("vertical", query.vertical);
  if (query.dealType) everywhere.set("dealType", query.dealType);
  if (query.q) everywhere.set("q", query.q);
  everywhere.set("cityId", "all");
  const everywhereHref = `/classifieds?${everywhere.toString()}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Объявления</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Недвижимость, автомобили, услуги и работа с реальной геопривязкой
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Разделы объявлений">
          <Link href="/classifieds" className={`rounded-full border px-3 py-1 ${!query.vertical ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>
            Все
          </Link>
          {Object.entries(VERTICAL_LABELS).map(([k, v]) => (
            <Link key={k} href={`/classifieds?vertical=${k}`} className={`rounded-full border px-3 py-1 ${query.vertical === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>
              {verticalEmoji(k)} {v}
            </Link>
          ))}
        </nav>
      </header>

      <form className="mb-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Поиск..."
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
        <select name="vertical" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
          <option value="">Все вертикали</option>
          {Object.entries(VERTICAL_LABELS).map(([k, v]) => (
            <option key={k} value={k} selected={query.vertical === k}>
              {v}
            </option>
          ))}
        </select>
        <select name="dealType" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
          <option value="">Любая сделка</option>
          {Object.entries(DEAL_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k} selected={query.dealType === k}>
              {v}
            </option>
          ))}
        </select>
        <CityFilter cities={cities} initialId={cityId ?? ""} />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Применить
          </button>
          <Link
            href="/classifieds/new"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
          >
            Разместить объявление
          </Link>
          <Link
            href="/classifieds/my"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
          >
            Мои объявления
          </Link>
        </div>
      </form>

      {myCity && (
        <p className="mb-3 rounded-lg bg-svetlana-50 px-3 py-2 text-sm text-ink" role="status">
          Показаны объявления в городе {myCity.name}.{" "}
          <Link href={everywhereHref} className="underline">Показать по всей России</Link>
          {" · "}
          <Link href="/city" className="underline">Сменить город</Link>
        </p>
      )}

      <p className="mb-3 text-sm text-zinc-500">{result.items.length} объявлений</p>

      {result.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500">
          {myCity ? (
            <>
              В городе {myCity.name} пока ничего не нашлось.{nearbyAds.length > 0 ? " Ниже объявления из соседних городов." : ""}{" "}
              <Link href={everywhereHref} className="underline">Посмотреть по всей России</Link>
            </>
          ) : (
            "Ничего не найдено. Попробуйте изменить фильтры."
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((ad) => (
            <li
              key={ad.id}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
            >
              <Link href={`/classifieds/${ad.id}`}>
                {ad.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ad.coverImage}
                    alt={ad.title}
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center bg-zinc-100 text-3xl">
                    {verticalEmoji(ad.vertical)}
                  </div>
                )}
              </Link>
              <div className="p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                    {verticalLabel(ad.vertical)}
                  </span>
                  <span>{dealTypeLabel(ad.dealType)}</span>
                </div>
                <Link href={`/classifieds/${ad.id}`}>
                  <h3 className="line-clamp-2 font-semibold hover:underline">{ad.title}</h3>
                </Link>
                {ad.priceKopecks > 0 ? (
                  <p className="mt-1 font-bold">{priceText(ad.dealType, ad.attrs, rub(ad.priceKopecks))}</p>
                ) : (
                  <p className="mt-1 font-bold text-zinc-500">Цена не указана</p>
                )}
                <p className="mt-2 text-sm text-zinc-600">
                  {ad.cityName}
                  {ad.districtName ? `, ${ad.districtName}` : ""}
                  {ad.metroName ? ` · м. ${ad.metroName}` : ""}
                </p>
                {ad.sellerDisplayName && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {ad.sellerDisplayName}
                    {ad.sellerVerified ? " ✓" : ""}
                  </p>
                )}
                {ad.vinCheck && (
                  <p
                    className={`mt-2 text-xs font-medium ${
                      ad.vinCheck.verification === "VERIFIED"
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    VIN: {ad.vinCheck.status}
                    {ad.vinCheck.verification === "NOT_PROVEN" ? " · требуется проверка" : ""}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {myCity && nearbyAds.length > 0 && (
        <section className="mt-8" aria-label="Объявления рядом">
          <h2 className="mb-1 text-lg font-semibold">Рядом с городом {myCity.name}</h2>
          <p className="mb-3 text-xs text-zinc-500">Соседние города до {NEARBY_RADIUS_KM} км, расстояние по прямой между центрами городов.</p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {nearbyAds.map((ad) => (
              <li key={ad.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <Link href={`/classifieds/${ad.id}`} className="block">
                  {ad.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ad.cover} alt={ad.title} className="h-32 w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center bg-zinc-100 text-3xl">{verticalEmoji(ad.vertical)}</div>
                  )}
                  <div className="p-3">
                    <h3 className="line-clamp-2 text-sm font-semibold hover:underline">{ad.title}</h3>
                    <p className="mt-1 text-sm font-bold">{ad.priceKopecks > 0 ? priceText(ad.dealType, {}, rub(ad.priceKopecks)) : "Цена не указана"}</p>
                    <p className="mt-1 text-xs text-zinc-600">{ad.cityName} · ≈ {ad.km} км</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
