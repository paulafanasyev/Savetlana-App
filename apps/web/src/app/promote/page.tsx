import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { myPromotions, promotableItems } from "@/lib/domains/promotions";
import { PROMO_PLANS, isActive, perDay, timeLeft } from "@/lib/promo";
import { PromoteForm } from "./PromoteForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Продвижение" };

/** Продвижение своего объявления или товара в правой колонке сайта. */
export default async function PromotePage() {
  const { user } = await requireUserServer();
  const [items, promos] = await Promise.all([promotableItems(user.id), myPromotions(user.id)]);
  const now = new Date();
  const titles = new Map(items.map((i) => [`${i.kind}/${i.id}`, i.title]));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Продвижение</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Ваше объявление или товар показывается в правой колонке на всех страницах сайта (на компьютере). Все продвигаемые
          показываются по очереди, у каждого равный шанс.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PROMO_PLANS.map((p) => (
          <div key={p.id} className="card p-4">
            <div className="text-sm text-ink-soft">{p.label}</div>
            <div className="text-2xl font-semibold text-ink">{p.priceRub} ₽</div>
            <div className="text-xs text-ink-soft">{perDay(p)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
        Оплата пока в тестовом режиме: деньги не списываются, продвижение включается сразу. Настоящая оплата появится после
        подключения банка.
      </div>

      {items.length === 0 ? (
        <div className="card p-4 text-sm text-ink-soft">
          Пока нечего продвигать: нужно опубликованное объявление или товар в продаже.{" "}
          <Link href="/classifieds/new" className="underline">Разместить объявление</Link>
        </div>
      ) : (
        <PromoteForm items={items} />
      )}

      {promos.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">Мои продвижения</h2>
          <ul className="divide-y divide-surface-line rounded-xl border border-surface-line">
            {promos.map((p) => (
              <li key={`${p.kind}-${p.itemId}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="truncate">{titles.get(`${p.kind}/${p.itemId}`) ?? (p.kind === "product" ? "Товар" : "Объявление")}</span>
                <span className={isActive(p, now) ? "whitespace-nowrap text-green-700" : "whitespace-nowrap text-ink-soft"}>
                  {isActive(p, now) ? timeLeft(p, now) : "закончилось"} · оплачено {p.paidRub} ₽{p.sandbox ? " (тест)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
