import Link from "next/link";
import { searchClassifieds, getGeoTree } from "@/lib/domains/classifieds";
import { rub } from "@/lib/format";

export const dynamic = "force-dynamic";

const VERTICALS: Record<string, string> = {
  REAL_ESTATE: "Недвижимость",
  AUTO: "Авто",
  SERVICE: "Услуги",
};

const DEAL_TYPES: Record<string, string> = {
  SELL: "Продажа",
  LONG_RENT: "Аренда (длительно)",
  DAILY_RENT: "Посуточно",
  RENT_DAILY: "Подённо",
  BUY: "Куплю",
  SERVICE_OFFER: "Предлагаю услугу",
  SERVICE_REQUEST: "Нужна услуга",
};

export default async function ClassifiedsPage({
  searchParams,
}: {
  searchParams: { vertical?: string; dealType?: string; cityId?: string; q?: string };
}) {
  const result = await searchClassifieds({
    vertical: searchParams.vertical,
    dealType: searchParams.dealType,
    cityId: searchParams.cityId,
    query: searchParams.q,
    limit: 30,
  });
  const tree = await getGeoTree();

  const cities = tree.flatMap((d) => d.regions.flatMap((r) => r.cities));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Объявления</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Недвижимость, автомобили и услуги с реальной геопривязкой
        </p>
      </header>

      <form className="mb-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="Поиск..."
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
        <select name="vertical" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
          <option value="">Все вертикали</option>
          {Object.entries(VERTICALS).map(([k, v]) => (
            <option key={k} value={k} selected={searchParams.vertical === k}>
              {v}
            </option>
          ))}
        </select>
        <select name="dealType" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
          <option value="">Любая сделка</option>
          {Object.entries(DEAL_TYPES).map(([k, v]) => (
            <option key={k} value={k} selected={searchParams.dealType === k}>
              {v}
            </option>
          ))}
        </select>
        <select name="cityId" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
          <option value="">Весь регион</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id} selected={searchParams.cityId === c.id}>
              {c.name}
            </option>
          ))}
        </select>
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
        </div>
      </form>

      <p className="mb-3 text-sm text-zinc-500">{result.items.length} объявлений</p>

      {result.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500">
          Ничего не найдено. Попробуйте изменить фильтры.
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
                    {VERTICALS[ad.vertical] === "Авто" ? "🚗" : VERTICALS[ad.vertical] === "Услуги" ? "🛠" : "🏠"}
                  </div>
                )}
              </Link>
              <div className="p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                    {VERTICALS[ad.vertical] ?? ad.vertical}
                  </span>
                  <span>{DEAL_TYPES[ad.dealType] ?? ad.dealType}</span>
                </div>
                <Link href={`/classifieds/${ad.id}`}>
                  <h3 className="line-clamp-2 font-semibold hover:underline">{ad.title}</h3>
                </Link>
                {ad.priceKopecks > 0 ? (
                  <p className="mt-1 font-bold">{rub(ad.priceKopecks)}</p>
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
    </main>
  );
}
