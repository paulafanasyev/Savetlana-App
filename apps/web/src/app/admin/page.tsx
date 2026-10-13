import { getAdminOverview } from "@/lib/domains/admin";
import { rub } from "@/lib/format";
import { orderStatusLabel } from "@/lib/format";
import { DemoCatalogPanel } from "@/components/DemoCatalogPanel";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const overview = await getAdminOverview();
  const orderStatuses = Object.entries(overview.orders.byStatus).sort((a, b) => b[1] - a[1]);
  const riskLevels = Object.entries(overview.risk.byLevel);

  return (
    <div className="space-y-6">
      <DemoCatalogPanel />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Пользователи" value={overview.users.total} hint={`покупателей: ${overview.users.buyers} · продавцов: ${overview.users.sellers}`} />
        <Stat label="Заблокировано" value={overview.users.blocked} />
        <Stat label="Товары" value={overview.products.total} hint={`активных: ${overview.products.active} · AI-черновиков: ${overview.products.aiDraft}`} />
        <Stat label="Заказов" value={overview.orders.total} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Оборот (оплачено)" value={rub(overview.payments.grossKopecks)} />
        <Stat label="Комиссия платформы" value={rub(overview.payments.platformFeeKopecks)} hint="из расчётов по заказам" />
        <Stat label="Отзывы" value={overview.reviews.total} hint={`скрытых: ${overview.reviews.hidden}`} />
        <Stat label="Открытые риски" value={overview.risk.openEvents} hint={riskLevels.map(([l, n]) => `${l}: ${n}`).join(" · ") || "нет"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">Заказы по статусам</h2>
          {orderStatuses.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Заказов пока нет</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {orderStatuses.map(([status, count]) => (
                <li key={status} className="flex justify-between">
                  <span className="text-ink-soft">{orderStatusLabel(status)}</span>
                  <span className="font-medium text-ink">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">Верификация продавцов</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-ink-soft">Ожидают проверки</span>
              <span className="font-medium text-amber-700">{overview.verification.pendingSellers}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-soft">Верифицированы</span>
              <span className="font-medium text-green-700">{overview.verification.verifiedSellers}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}
