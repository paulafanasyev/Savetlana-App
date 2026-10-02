import { redirect } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { searchGlobally } from "@/lib/domains/external-search";
import { getMarketplaceAvailability, tierLabel } from "@/lib/marketplaces";
import { rub } from "@/lib/format";
import { fromKopecks } from "@/lib/utils";
import { resolveSearchParams } from "@/lib/page-params";

export const dynamic = "force-dynamic";

const TIER_SELECT: Record<number, string> = { 1: "🇷🇺 Россия", 2: "🌍 Весь мир" };

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tier?: string }>;
}) {
  const user = await requireUserServer();

  const query = await resolveSearchParams(searchParams);
  const q = query.q?.trim() ?? "";
  const tier = query.tier === "2" ? 2 : 1;
  const availability = await getMarketplaceAvailability();

  const report =
    q.length > 0
      ? await searchGlobally({ text: q, limit: 30 }, tier)
      : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Глобальный поиск</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Светлана ищет товар по всей сети — и всегда показывает предложения нашей платформы
          первыми
        </p>
      </header>

      <form className="mb-6 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            name="q"
            defaultValue={q}
            placeholder="Например: наушники, куртка, смартфон…"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <select name="tier" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            {Object.entries(TIER_SELECT).map(([k, v]) => (
              <option key={k} value={k} selected={Number(k) === tier}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Найти
        </button>
      </form>

      {report && report.platformAdvantage && (
        <section className="mb-6 rounded-xl border border-svetlana-200 bg-svetlana-50 p-4">
          <h2 className="text-sm font-semibold text-svetlana-900">
            Сравнение в пользу платформы
          </h2>
          <p className="mt-1 text-sm text-svetlana-800">
            {report.platformAdvantage.platformIsCheapest
              ? `Наша платформа предлагает самую низкую цену: ${rub(
                  report.platformAdvantage.cheapestPlatform,
                )} против ${rub(report.platformAdvantage.cheapestExternal)} у внешних площадок. Выгода ${fromKopecks(
                  report.platformAdvantage.savingKopecks,
                )} ₽.`
              : `Внешние площадки дешевле на ${fromKopecks(
                  report.platformAdvantage.cheapestExternal - report.platformAdvantage.cheapestPlatform,
                )} ₽ (${rub(report.platformAdvantage.cheapestExternal)} против нашего ${rub(
                  report.platformAdvantage.cheapestPlatform,
                )}), но предложения платформы остаются первыми в выдаче — у них проверенный продавец и наша защита сделки.`}
          </p>
        </section>
      )}

      {report && (
        <p className="mb-3 text-sm text-zinc-500">
          Найдено: {report.bySource.platform} на платформе · {report.bySource.external} на внешних
          площадках · охват: {tierLabel(tier)}
        </p>
      )}

      {report && report.warnings.length > 0 && (
        <ul className="mb-6 space-y-1">
          {report.warnings.map((w, i) => (
            <li key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {w}
            </li>
          ))}
        </ul>
      )}

      {!report ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500">
          Введите запрос — Светлана найдёт товар на платформе и во внешних магазинах.
        </div>
      ) : report.hits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500">
          Ничего не найдено. Попробуйте сформулировать иначе.
        </div>
      ) : (
        <ul className="grid gap-4">
          {report.hits.map((h, i) => (
            <li
              key={`${h.source}-${h.externalId ?? h.url}-${i}`}
              className={`rounded-xl border bg-white p-4 ${
                h.source === "platform"
                  ? "border-svetlana-300 ring-1 ring-svetlana-200"
                  : "border-zinc-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={`mb-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      h.source === "platform"
                        ? "bg-svetlana-100 text-svetlana-800"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {h.source === "platform"
                      ? "Наша платформа"
                      : h.marketplace ?? "Внешний магазин"}
                  </span>
                  <a
                    href={h.url}
                    className="block font-semibold hover:underline"
                    target={h.source === "platform" ? undefined : "_blank"}
                    rel={h.source === "platform" ? undefined : "noopener noreferrer"}
                  >
                    {h.title}
                  </a>
                  <p className="text-xs text-zinc-500">
                    {h.sellerName ?? "продавец не указан"}
                    {h.rating ? ` · ★ ${h.rating}` : ""}
                    {h.reviewsCount ? ` · ${h.reviewsCount} отзывов` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="whitespace-nowrap font-bold">{rub(h.priceKopecks)}</p>
                  {h.oldPriceKopecks ? (
                    <p className="whitespace-nowrap text-xs text-zinc-400 line-through">
                      {rub(h.oldPriceKopecks)}
                    </p>
                  ) : null}
                  <p
                    className={`mt-1 text-xs font-medium ${
                      h.confidence === "VERIFIED" ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {h.confidence === "VERIFIED" ? "цена проверена" : "цена не подтверждена"}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          Какие площадки сейчас доступны
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {availability.map((a) => (
            <li
              key={a.key}
              className={`rounded-lg border px-3 py-2 text-sm ${
                a.reachable
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <span className="font-medium">{a.label}</span>
              <span className="ml-2">{a.reachable ? "доступно" : "недоступно"}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
