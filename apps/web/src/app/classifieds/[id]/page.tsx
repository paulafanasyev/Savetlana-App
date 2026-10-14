import Link from "next/link";
import { notFound } from "next/navigation";
import { getClassifiedPublic, incrementViews } from "@/lib/domains/classifieds";
import { describeAttrs } from "@/lib/classified-fields";
import { rub, timeAgo } from "@/lib/format";
import { dealTypeLabel, verticalEmoji, verticalLabel } from "@/lib/verticals";
import { resolveParams } from "@/lib/page-params";

export const dynamic = "force-dynamic";

export default async function ClassifiedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await resolveParams(params);
  // Count the view before rendering so popularity reflects real visits.
  await incrementViews(id).catch(() => {});
  const ad = await getClassifiedPublic(id);
  if (!ad) notFound();

  // Характеристики с русскими подписями; VIN показываем не целиком.
  const attrs = describeAttrs(ad.vertical, ad.attrs);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/classifieds" className="mb-4 inline-block text-sm text-zinc-600 hover:underline">
        ← К объявлениям
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          {ad.images.length > 0 ? (
            <div className="grid gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ad.coverImage ?? ad.images[0]}
                alt={ad.title}
                className="aspect-square w-full rounded-xl object-cover"
              />
              {ad.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {ad.images.slice(1, 9).map((img) => (
                    <a key={img} href={img} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={ad.title} className="aspect-square w-full rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-zinc-100 text-6xl">
              {verticalEmoji(ad.vertical)}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
              {verticalLabel(ad.vertical)}
            </span>
            <span>{dealTypeLabel(ad.dealType)}</span>
          </div>
          <h1 className="text-xl font-bold">{ad.title}</h1>
          {ad.priceKopecks > 0 ? (
            <p className="mt-2 text-2xl font-bold">
              {rub(ad.priceKopecks)}
              {ad.dealType === "LONG_RENT" || ad.dealType === "RENT" ? <span className="text-base font-medium text-zinc-500"> в месяц</span> : null}
              {ad.dealType === "DAILY_RENT" ? <span className="text-base font-medium text-zinc-500"> за сутки</span> : null}
            </p>
          ) : (
            <p className="mt-2 text-lg font-bold text-zinc-500">Цена не указана</p>
          )}

          <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm">
            <p className="font-medium">📍 {ad.cityName}</p>
            <p className="mt-1 text-zinc-600">
              {ad.regionName}
              {ad.districtName ? ` · ${ad.districtName}` : ""}
              {ad.addressLine ? ` · ${ad.addressLine}` : ""}
            </p>
            {ad.metroName && (
              <p className="mt-1 text-zinc-600">
                м. {ad.metroName} ({ad.metroLineName})
                {ad.metroWalkMin ? ` · ${ad.metroWalkMin} мин пешком` : ""}
              </p>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm">
            <p className="font-medium">Автор: {ad.authorName ?? "Без имени"}</p>
            {ad.sellerDisplayName && (
              <p className="mt-1 text-zinc-600">
                {ad.sellerDisplayName}
                {ad.sellerVerified ? " · верифицированный продавец ✓" : ""}
              </p>
            )}
            <p className="mt-1 text-zinc-500">Опубликовано {timeAgo(ad.createdAt)}</p>
          </div>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Не переводите задаток и предоплату до встречи и просмотра. Не переходите по ссылкам «на оплату» и не
            называйте коды из СМС.
          </div>

          {ad.vertical === "AUTO" && (
            <form action={`/api/classifieds/${ad.id}/vin-check`} method="POST" className="mt-4">
              <label className="block text-sm font-medium">Проверка по VIN</label>
              <p className="mb-2 text-xs text-zinc-500">
                Отчёт о ДТП, пробеге, количестве владельцев и ограничениях. До
                подключения официального источника результат помечается как
                требующий проверки.
              </p>
              <input
                name="vin"
                placeholder="17-значный VIN"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                required
                minLength={10}
              />
              <button
                type="submit"
                className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
              >
                Проверить VIN
              </button>
            </form>
          )}
        </div>
      </div>

      {ad.description && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Описание</h2>
          <p className="whitespace-pre-line text-zinc-700">{ad.description}</p>
        </section>
      )}

      {attrs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Характеристики</h2>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {attrs.map((row) => (
              <div key={row.label} className="flex justify-between border-b border-zinc-100 py-1 text-sm">
                <dt className="text-zinc-600">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {ad.vinCheck && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Отчёт о проверке VIN</h2>
          <div
            className={`rounded-lg border p-4 ${
              ad.vinCheck.verification === "VERIFIED"
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
            }`}
          >
            <p className="font-medium">
              VIN: {ad.vinCheck.vinMasked} · статус: {ad.vinCheck.status}
            </p>
            {ad.vinCheck.make && (
              <p className="mt-1 text-sm">
                {ad.vinCheck.make} {ad.vinCheck.model} {ad.vinCheck.year ?? ""}
              </p>
            )}
            {ad.vinCheck.mileageKm != null && (
              <p className="text-sm">Пробег: {ad.vinCheck.mileageKm.toLocaleString("ru-RU")} км</p>
            )}
            {ad.vinCheck.ownersCount != null && (
              <p className="text-sm">Владельцев: {ad.vinCheck.ownersCount}</p>
            )}
            {ad.vinCheck.isWanted && (
              <p className="text-sm font-medium text-red-700">⚠ Транспорт в розыске</p>
            )}
            {ad.vinCheck.hasRestrictions && (
              <p className="text-sm font-medium text-red-700">
                ⚠ Есть ограничения на регистрацию
              </p>
            )}
            <ul className="mt-2 space-y-1 text-sm">
              {(ad.vinCheck.findings as { description: string }[]).map((f, i) => (
                <li key={i} className="text-zinc-700">
                  • {f.description}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              {ad.vinCheck.verification === "VERIFIED"
                ? `Источник: ${ad.vinCheck.source}. Проверено ${timeAgo(ad.vinCheck.checkedAt)}.`
                : `Источник: ${ad.vinCheck.source}. Результат требует подтверждения официальным источником — не принимайте решение только на его основе.`}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
