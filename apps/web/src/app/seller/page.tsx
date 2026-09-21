import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { sellerReport } from "@/lib/domains/seller-analytics";
import { rub } from "@/lib/format";
import { SvetlanaChat } from "@/components/SvetlanaChat";

export const dynamic = "force-dynamic";

export default async function SellerDashboard() {
  const { sellerId, user } = await requireSellerServer();
  const report = await sellerReport(sellerId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Кабинет продавца</h1>
          <p className="text-sm text-ink-soft">{user.name} · управление магазином</p>
        </div>
        <div className="flex gap-2">
          <Link href="/seller/products" className="btn btn-ghost">Товары</Link>
          <Link href="/seller/orders" className="btn btn-ghost">Заказы</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Товаров" value={report.totals.products} hint={`активных: ${report.totals.active}`} />
        <Stat label="Заказов" value={report.totals.orders} />
        <Stat label="Выручка" value={rub(report.totals.revenueKopecks)} />
        <Stat
          label="Конверсия"
          value={(report.totals.avgConversion * 100).toFixed(1) + "%"}
          hint="заказы / просмотры"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {report.salesDropCauses.length > 0 && (
            <div className="card p-5">
              <h2 className="text-base font-bold text-ink">Диагностика продаж</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                {report.salesDropCauses.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-svetlana-600">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.recommendations.length > 0 && (
            <div className="card p-5">
              <h2 className="text-base font-bold text-ink">Рекомендации Светланы</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {report.recommendations.map((r, i) => (
                  <li key={i} className="border-l-2 border-svetlana-300 pl-3">
                    <div className="font-medium text-ink">{r.text}</div>
                    <div className="mt-0.5 text-xs text-ink-faint">Основание: {r.evidence}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.lowStock.length > 0 && (
            <div className="card p-5">
              <h2 className="text-base font-bold text-ink">Заканчивается наличие</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                {report.lowStock.map((p) => (
                  <li key={p.productId} className="flex justify-between">
                    <span className="truncate">{p.title}</span>
                    <span className="font-medium text-amber-700">осталось {p.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <SvetlanaChat side="seller" title="Светлана для бизнеса" />
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
