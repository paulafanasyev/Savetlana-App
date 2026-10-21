import Link from "next/link";
import { railCards, type RailCard } from "@/lib/domains/promotions";
import { PROMO_PLANS } from "@/lib/promo";
import { PromoVisibility } from "./PromoVisibility";

function rub(kopecks: number): string {
  return kopecks > 0 ? `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽` : "Цена договорная";
}

const CHEAPEST = Math.min(...PROMO_PLANS.map((p) => p.priceRub));

function Card({ c, compact = false }: { c: RailCard; compact?: boolean }) {
  return (
    <Link href={c.href} className="block overflow-hidden rounded-xl border border-surface-line bg-white hover:shadow-float" data-testid="promo-card">
      {c.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.image} alt={c.title} className="aspect-[4/3] w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface-muted text-2xl" aria-hidden>
          {c.kind === "product" ? "🛍️" : "📋"}
        </div>
      )}
      <div className={compact ? "p-1.5" : "p-2"}>
        <div className="line-clamp-2 text-xs font-medium text-ink">{c.title}</div>
        <div className="mt-1 text-sm font-semibold text-ink">{rub(c.priceKopecks)}</div>
        {c.city && <div className="text-[11px] text-ink-soft">{c.city}</div>}
      </div>
    </Link>
  );
}

/**
 * Каркас страницы с продвижением. На широком экране справа колонка с
 * продвигаемыми объявлениями и товарами, на телефоне и планшете те же
 * карточки лентой под содержимым страницы. Карточки берутся из базы один раз.
 * Пока продвигать нечего, колонки нет совсем: пустое «здесь может быть ваше
 * объявление» на каждой странице выглядит недоделанным, а ссылка на продвижение
 * есть в подвале. На юридических и служебных страницах блок скрыт (PromoVisibility).
 */
export async function PromoLayout({ children }: { children: React.ReactNode }) {
  let cards: RailCard[] = [];
  try {
    cards = await railCards();
  } catch {
    cards = [];
  }
  const hasCards = cards.length > 0;
  return (
    <div className="flex flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1">{children}</main>
        {hasCards && (
          <PromoVisibility>
            <section className="border-t border-surface-line bg-surface-muted px-4 py-4 xl:hidden" aria-label="Продвигается">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">Продвигается</h2>
                <span className="text-[10px] uppercase tracking-wide text-ink-faint">Реклама</span>
              </div>
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {cards.map((c) => (
                  <li key={`${c.kind}-${c.id}`} className="w-40 shrink-0">
                    <Card c={c} compact />
                  </li>
                ))}
              </ul>
              <Link href="/promote" className="mt-2 inline-block text-xs text-svetlana-700 underline">
                Продвинуть своё от {CHEAPEST} ₽
              </Link>
            </section>
          </PromoVisibility>
        )}
      </div>
      {hasCards && (
        <PromoVisibility>
          <aside className="hidden w-60 shrink-0 border-l border-surface-line bg-white px-3 py-4 xl:block" aria-label="Продвижение">
            <div className="sticky top-20 space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">Продвигается</h2>
                <span className="text-[10px] uppercase tracking-wide text-ink-faint">Реклама</span>
              </div>
              <ul className="space-y-3">
                {cards.map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <Card c={c} />
                  </li>
                ))}
              </ul>
              <Link href="/promote" className="btn btn-primary w-full justify-center px-3 py-2 text-xs">
                Продвинуть своё от {CHEAPEST} ₽
              </Link>
            </div>
          </aside>
        </PromoVisibility>
      )}
    </div>
  );
}
