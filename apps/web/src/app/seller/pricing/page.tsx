import { requireSellerServer } from "@/lib/auth";
import { adviseOnPrice, priceHistory, pricePosition } from "@/lib/domains/pricing";
import { findCompetitors } from "@/lib/domains/competitors";
import { rub } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { resolveSearchParams } from "@/lib/page-params";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Pricing & Competitors (spec §13, §19, §54).
 *
 * The AI advises; the seller decides. A price change is a substantial
 * commercial action and is applied only after explicit confirmation — never
 * silently by the agent (spec §147).
 */
export default async function SellerPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { sellerId } = await requireSellerServer();
  const productId = (await resolveSearchParams(searchParams)).productId;

  const products = await prisma.product.findMany({
    where: { sellerId },
    orderBy: { title: "asc" },
    select: { id: true, title: true, priceKopecks: true, status: true },
  });

  if (!productId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold text-ink">Цены и конкуренты</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Выберите товар, чтобы увидеть его позицию на рынке
        </p>
        <ul className="mt-6 space-y-2">
          {products.map((p) => (
            <li key={p.id}>
              <Link
                href={`/seller/pricing?productId=${p.id}`}
                className="card flex items-center justify-between p-4 transition hover:border-svetlana-300"
              >
                <span className="font-medium text-ink">{p.title}</span>
                <span className="text-sm text-ink-soft">{rub(p.priceKopecks)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId },
  });
  if (!product) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-sm text-ink-soft">Товар не найден в вашем каталоге.</p>
        <Link href="/seller/pricing" className="btn btn-ghost mt-4">← к списку</Link>
      </div>
    );
  }

  const [advice, history, competitors] = await Promise.all([
    adviseOnPrice(product.id),
    priceHistory(product.id),
    findCompetitors(product.id),
  ]);
  const position = advice.position;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/seller/pricing" className="text-sm text-svetlana-600 hover:underline">
        ← все товары
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-ink">{product.title}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Текущая цена {rub(product.priceKopecks)}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Позиция"
          value={positionLabel(position.position)}
          hint={position.competitorCount ? `${position.competitorCount} предложений` : "нет данных"}
        />
        <Stat
          label="Медиана рынка"
          value={position.marketMedian ? rub(position.marketMedian) : "нет данных"}
        />
        <Stat
          label="Коридор"
          value={
            position.marketMin && position.marketMax
              ? `${rub(position.marketMin)} – ${rub(position.marketMax)}`
              : "нет данных"
          }
        />
        <Stat
          label="Перцентиль"
          value={position.percentile !== null ? `${position.percentile}%` : "—"}
          hint="доля предложений дешевле вашего"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Competitor offers */}
          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Конкуренты</h2>
            <p className="mt-1 text-xs text-ink-faint">
              Только публичные предложения маркетплейса. Закрытые данные других
              продавцов не используются (spec §13).
            </p>
            {competitors.offers.length === 0 ? (
              <p className="mt-4 text-sm text-ink-faint">
                Публичных конкурентов по этому товару не найдено.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {competitors.offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium text-ink">{o.sellerName}</div>
                      <div className="text-xs text-ink-faint">
                        {o.rating ? `★ ${o.rating.toFixed(1)}` : "без рейтинга"}
                        {o.reviewsCount ? ` · ${o.reviewsCount} отзывов` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-ink">{rub(o.priceKopecks)}</div>
                      <div
                        className={`text-xs ${
                          o.deltaKopecks < 0
                            ? "text-green-700"
                            : o.deltaKopecks > 0
                              ? "text-red-600"
                              : "text-ink-faint"
                        }`}
                      >
                        {o.deltaKopecks === 0
                          ? "одинаково"
                          : `${o.deltaKopecks < 0 ? "дешевле на" : "дороже на"} ${rub(Math.abs(o.deltaKopecks))}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {competitors.gaps.length > 0 && (
              <div className="mt-4 rounded-lg bg-amber-50 p-3">
                <div className="text-xs font-medium text-amber-800">
                  Незаполненные преимущества вашей карточки
                </div>
                <ul className="mt-2 space-y-1 text-xs text-amber-700">
                  {competitors.gaps.map((g, i) => (
                    <li key={i}>• {g}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Price history */}
          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">История цены</h2>
            {history.length === 0 ? (
              <p className="mt-4 text-sm text-ink-faint">
                Изменений цены не зафиксировано.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between py-3">
                    <span className="text-sm font-medium text-ink">{rub(h.priceKopecks)}</span>
                    <span className="text-xs text-ink-faint">
                      {h.at.toLocaleDateString("ru-RU")}
                      {h.note ? ` · ${h.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* AI advice */}
        <section className="card h-fit p-5">
          <h2 className="text-base font-bold text-ink">Совет Светланы</h2>
          <div className="mt-3">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                advice.direction === "lower"
                  ? "bg-red-100 text-red-800"
                  : advice.direction === "raise"
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-700"
              }`}
            >
              {advice.direction === "lower"
                ? "Снизить цену"
                : advice.direction === "raise"
                  ? "Повысить цену"
                  : "Держать цену"}
            </span>
            {advice.suggestedPriceKopecks && (
              <span className="ml-2 text-sm font-medium text-ink">
                до {rub(advice.suggestedPriceKopecks)}
              </span>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {advice.reasoning.map((r, i) => (
              <p key={i} className="text-xs leading-relaxed text-ink-soft">
                {r}
              </p>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full bg-svetlana-500"
                style={{ width: `${Math.round(advice.confidence * 100)}%` }}
              />
            </div>
            <span className="text-xs text-ink-faint">
              уверенность {Math.round(advice.confidence * 100)}%
            </span>
          </div>

          {advice.suggestedPriceKopecks &&
            advice.suggestedPriceKopecks !== product.priceKopecks && (
              <form
                action={`/api/seller/pricing?productId=${product.id}`}
                method="POST"
                className="mt-5 space-y-3"
              >
                <input type="hidden" name="productId" value={product.id} />
                <input
                  type="hidden"
                  name="newPriceRubles"
                  value={(advice.suggestedPriceKopecks / 100).toFixed(2)}
                />
                <label className="flex items-start gap-2 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    name="confirm"
                    required
                    className="mt-0.5"
                  />
                  <span>
                    Я подтверждаю изменение цены на {rub(advice.suggestedPriceKopecks)}
                  </span>
                </label>
                <button type="submit" className="btn btn-primary w-full">
                  Применить цену
                </button>
              </form>
            )}

          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Светлана советует на основе публичных данных и вашей истории. Итоговое
            решение остаётся за продавцом.
          </p>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}

function positionLabel(position: string): string {
  switch (position) {
    case "above_market":
      return "Выше рынка";
    case "below_market":
      return "Ниже рынка";
    case "at_market":
      return "В коридоре";
    default:
      return "Нет данных";
  }
}
