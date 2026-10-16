import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveParams } from "@/lib/page-params";
import { rub, timeAgo } from "@/lib/format";
import { loadPerformer } from "@/lib/domains/performer-profile";
import { performerFacts } from "@/lib/performer-profile";
import { stars } from "@/lib/service-reviews";

export const dynamic = "force-dynamic";

/** Публичный профиль исполнителя: факты площадки, отзывы заказчиков и его услуги. */
export default async function PerformerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await resolveParams(params);
  const p = await loadPerformer(id);
  if (!p) notFound();
  const facts = performerFacts({ stats: p.stats, npdStatus: p.npdStatus, identityStatus: p.identityStatus, since: p.since, ratings: p.ratings });
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <section className="card p-5">
        <p className="text-xs uppercase tracking-wide text-ink-faint">Исполнитель</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{p.name}</h1>
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {facts.map((f) => <li key={f}>• {f}</li>)}
        </ul>
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          🛡 Оплачивайте работу только через безопасную сделку на площадке: деньги придут исполнителю только после того, как вы примете работу. Не переводите деньги на карту напрямую.
        </p>
      </section>
      <section className="card p-5" id="reviews">
        <h2 className="text-lg font-semibold">Отзывы заказчиков</h2>
        <p className="mt-1 text-xs text-ink-faint">Отзыв может оставить только заказчик, который принял работу через безопасную сделку. Исполнитель не может его удалить.</p>
        {p.reviews.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Отзывов пока нет.</p>
        ) : (
          <ul className="mt-2 divide-y divide-surface-line">
            {p.reviews.map((r) => (
              <li key={r.orderNumber} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-amber-500" aria-label={`Оценка ${r.rating} из 5`}>{stars(r.rating)}</span>
                  <span className="text-xs text-ink-faint">Заказчик · {timeAgo(r.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-ink">{r.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-5">
        <h2 className="text-lg font-semibold">Услуги исполнителя</h2>
        {p.offers.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Опубликованных услуг пока нет.</p>
        ) : (
          <ul className="mt-2 divide-y divide-surface-line">
            {p.offers.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/classifieds/${o.id}`} className="text-ink hover:text-svetlana-700 hover:underline">{o.title}</Link>
                <span className="shrink-0 text-ink-soft">{o.priceKopecks > 0 ? rub(o.priceKopecks) : "цена договорная"}{o.city ? ` · ${o.city}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
