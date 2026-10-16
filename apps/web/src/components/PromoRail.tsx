import Link from "next/link";
import { railCards, type RailCard } from "@/lib/domains/promotions";
import { PROMO_PLANS } from "@/lib/promo";

function rub(kopecks: number): string {
  return kopecks > 0 ? `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽` : "Цена договорная";
}

/**
 * Правая колонка на широких экранах: платное продвижение объявлений и товаров.
 * Если база не ответила, колонка показывает только приглашение продвинуть своё.
 */
export async function PromoRail() {
  let cards: RailCard[] = [];
  try {
    cards = await railCards();
  } catch {
    cards = [];
  }
  const cheapest = Math.min(...PROMO_PLANS.map((p) => p.priceRub));
  return (
    <aside className="hidden w-60 shrink-0 border-l border-surface-line bg-white px-3 py-4 xl:block" aria-label="Продвижение">
      <div className="sticky top-20 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">Продвигается</h2>
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">Реклама</span>
        </div>
        {cards.length === 0 && <p className="text-xs text-ink-soft">Здесь может быть ваше объявление или товар.</p>}
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={`${c.kind}-${c.id}`}>
              <Link href={c.href} className="block overflow-hidden rounded-xl border border-surface-line hover:shadow-float" data-testid="promo-card">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image} alt={c.title} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface-muted text-2xl" aria-hidden>
                    {c.kind === "product" ? "🛍️" : "📋"}
                  </div>
                )}
                <div className="p-2">
                  <div className="line-clamp-2 text-xs font-medium text-ink">{c.title}</div>
                  <div className="mt-1 text-sm font-semibold text-ink">{rub(c.priceKopecks)}</div>
                  {c.city && <div className="text-[11px] text-ink-soft">{c.city}</div>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/promote" className="btn btn-primary w-full justify-center px-3 py-2 text-xs">
          Продвинуть своё от {cheapest} ₽
        </Link>
      </div>
    </aside>
  );
}
