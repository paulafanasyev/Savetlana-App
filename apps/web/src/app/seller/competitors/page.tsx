import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scanExternalCompetitors } from "@/lib/domains/external-search";
import { rub } from "@/lib/format";
import { fromKopecks } from "@/lib/utils";
import { getMarketplaceAvailability, tierLabel } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<number, string> = {
  1: "🇷🇺 Уровень 1 — Россия",
  2: "🌍 Уровень 2 — глобально",
};

export default async function GlobalCompetitorsPage({
  searchParams,
}: {
  searchParams: { productId?: string; tier?: string };
}) {
  const ctx = await requireSellerServer();

  const products = await prisma.product.findMany({
    where: { sellerId: ctx.sellerId },
    select: { id: true, title: true, sku: true, priceKopecks: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const tier = searchParams.tier === "2" ? 2 : 1;
  const productId = searchParams.productId ?? products[0]?.id;
  const availability = await getMarketplaceAvailability();

  let scan = null;
  if (productId) {
    try {
      scan = await scanExternalCompetitors(productId, { tier, limit: 10 });
    } catch {
      scan = null;
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Конкуренты: глобальный анализ</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Светлана анализирует конкурентов по всему интернету, а не только внутри платформы
        </p>
      </header>

      <form className="mb-6 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-700">Товар</span>
            <select
              name="productId"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id} selected={p.id === productId}>
                  {p.title} ({p.sku})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-700">Уровень охвата</span>
            <select name="tier" className="w-full rounded-lg border border-zinc-300 px-3 py-2">
              <option value="1" selected={tier === 1}>
                {TIER_LABEL[1]} — по умолчанию
              </option>
              <option value="2" selected={tier === 2}>
                {TIER_LABEL[2]} — по запросу
              </option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Запустить анализ
        </button>
      </form>

      <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          Доступность площадок ({tierLabel(tier)})
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
        {availability.every((a) => !a.reachable) && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Ни одна внешняя площадка сейчас не отвечает из этого окружения. Интеграции размечены как
            PENDING_EXTERNAL_ACCESS — при деплое с открытым выходом в сеть анализ заработает без
            изменения кода. Сейчас сравнение выполняется только по данным платформы.
          </p>
        )}
      </section>

      {!scan ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500">
          {products.length === 0
            ? "У вас пока нет товаров для анализа."
            : "Выберите товар и запустите анализ."}
        </div>
      ) : (
        <>
          <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{scan.ownTitle}</h2>
              <span className="font-bold">{rub(scan.ownPriceKopecks)}</span>
            </div>
            <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">{scan.verdict}</p>
            {!scan.liveExternal && (
              <p className="mt-2 text-xs text-amber-700">
                Внешние площадки не ответили — результаты анализа основаны только на данных платформы.
              </p>
            )}
          </section>

          {scan.marketplaces.map((m) => (
            <section
              key={m.key}
              className="mb-4 rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{m.label}</h3>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    m.status === "OK"
                      ? m.confidence === "VERIFIED"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                      : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {m.status === "OK"
                    ? m.confidence === "VERIFIED"
                      ? "VERIFIED"
                      : "NOT_PROVEN"
                    : m.status}
                </span>
              </div>
              {m.warning ? (
                <p className="text-sm text-zinc-500">{m.warning}</p>
              ) : m.offers.length === 0 ? (
                <p className="text-sm text-zinc-500">Предложений не найдено.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {m.offers.map((o, i) => (
                    <li key={`${o.externalId}-${i}`} className="flex items-center justify-between py-2">
                      <div className="min-w-0 pr-3">
                        <p className="truncate text-sm font-medium">{o.title}</p>
                        <p className="text-xs text-zinc-500">
                          {o.sellerName ?? "продавец не указан"}
                          {o.rating ? ` · ★ ${o.rating}` : ""}
                          {o.reviewsCount ? ` · ${o.reviewsCount} отзывов` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="whitespace-nowrap font-semibold">{rub(o.priceKopecks)}</p>
                        {o.priceKopecks < scan.ownPriceKopecks ? (
                          <p className="whitespace-nowrap text-xs text-emerald-700">
                            дешевле на {fromKopecks(scan.ownPriceKopecks - o.priceKopecks)} ₽
                          </p>
                        ) : (
                          <p className="whitespace-nowrap text-xs text-zinc-400">
                            дороже на {fromKopecks(o.priceKopecks - scan.ownPriceKopecks)} ₽
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}

      <div className="mt-6 flex gap-3">
        <Link
          href="/seller/pricing"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          ← Цены и конкуренты
        </Link>
        <Link
          href="/seller/products"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          Мои товары
        </Link>
      </div>
    </main>
  );
}
