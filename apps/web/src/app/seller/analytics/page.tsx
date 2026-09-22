import { requireSellerServer } from "@/lib/auth";
import { sellerReport } from "@/lib/domains/seller-analytics";
import { rub } from "@/lib/format";

export const dynamic = "force-dynamic";

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-sky-50 text-sky-700",
};
const PRIORITY_LABEL: Record<string, string> = {
  high: "Высокий приоритет",
  medium: "Средний приоритет",
  low: "Низкий приоритет",
};

export default async function SellerAnalyticsPage() {
  const { sellerId } = await requireSellerServer();
  const report = await sellerReport(sellerId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Аналитика продаж</h1>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="card p-4">
          <div className="text-xs text-ink-faint">Товаров</div>
          <div className="text-xl font-bold text-ink">{report.totals.products}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-faint">Активных</div>
          <div className="text-xl font-bold text-ink">{report.totals.active}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-faint">Заказов</div>
          <div className="text-xl font-bold text-ink">{report.totals.orders}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-faint">Выручка</div>
          <div className="text-xl font-bold text-ink">{rub(report.totals.revenueKopecks)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-faint">Конверсия</div>
          <div className="text-xl font-bold text-ink">{(report.totals.avgConversion * 100).toFixed(1)}%</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-faint">Рейтинг</div>
          <div className="text-xl font-bold text-ink">{report.totals.rating.toFixed(1)}</div>
        </div>
      </section>

      {report.salesDropCauses.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-ink">Почему могли упасть продажи</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-ink-soft">
            {report.salesDropCauses.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold text-ink">Рекомендации Светланы</h2>
        {report.recommendations.length === 0 ? (
          <p className="text-sm text-ink-soft">Сейчас рекомендаций нет — карточки в порядке.</p>
        ) : (
          <ul className="space-y-3">
            {report.recommendations.map((rec) => (
              <li key={rec.text} className="rounded-lg border border-surface-line p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`chip ${PRIORITY_STYLES[rec.priority]}`}>
                    {PRIORITY_LABEL[rec.priority]}
                  </span>
                </div>
                <div className="text-sm font-medium text-ink">{rec.text}</div>
                <div className="mt-1 text-xs text-ink-faint">На основании: {rec.evidence}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold text-ink">Здоровье карточек</h2>
        {report.health.length === 0 ? (
          <p className="text-sm text-ink-soft">Нет товаров для анализа.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-surface-line text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="px-3 py-2">Товар</th>
                  <th className="px-3 py-2">Health</th>
                  <th className="px-3 py-2">Проблемы</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line">
                {report.health.map((h) => (
                  <tr key={h.productId}>
                    <td className="px-3 py-2">
                      <a href={`/product/${h.productId}`} className="font-medium text-ink hover:text-svetlana-700">
                        {h.title}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`chip ${
                          h.healthScore >= 70
                            ? "bg-green-50 text-green-700"
                            : h.healthScore >= 40
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                        }`}
                      >
                        {h.healthScore}/100
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {h.issues.length === 0 ? "всё хорошо" : h.issues.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-ink">Заканчивается остаток</h2>
          {report.lowStock.length === 0 ? (
            <p className="text-sm text-ink-soft">Все остатки в норме.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {report.lowStock.map((item) => (
                <li key={item.productId} className="flex justify-between text-ink">
                  <span>{item.title}</span>
                  <span className="font-mono text-xs text-ink-soft">{item.quantity} шт.</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-ink">Залежавшиеся размещения</h2>
          {report.stale.length === 0 ? (
            <p className="text-sm text-ink-soft">Нет просроченных подтверждений наличия.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {report.stale.map((item) => (
                <li key={item.productId} className="flex justify-between text-ink">
                  <span>{item.title}</span>
                  <span className="font-mono text-xs text-ink-soft">{item.days} дн.</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
