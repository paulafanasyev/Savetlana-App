import { listAdminPayments } from "@/lib/domains/admin";
import { rub, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Admin payments & payouts section (spec §37, §26).
 *
 * HONESTY NOTE: every row is shown with its sandbox flag. A sandbox payment or
 * payout is money that never moved — it must be visually distinguishable from
 * a real partner transaction (spec §49).
 */
export default async function AdminPaymentsPage() {
  const { payments, payouts } = await listAdminPayments();

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-base font-bold text-ink">Платежи покупателей</h2>
          <p className="text-xs text-ink-soft">Последние {payments.length} записей</p>
        </div>
        {payments.length === 0 ? (
          <p className="p-6 text-sm text-ink-soft">Платежей пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2">Заказ</th>
                  <th className="px-4 py-2">Покупатель</th>
                  <th className="px-4 py-2">Сумма</th>
                  <th className="px-4 py-2">Провайдер</th>
                  <th className="px-4 py-2">Статус</th>
                  <th className="px-4 py-2">Режим</th>
                  <th className="px-4 py-2">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{p.orderId.slice(-8)}</td>
                    <td className="px-4 py-2 text-ink">{p.buyerName ?? "—"}</td>
                    <td className="px-4 py-2 font-medium text-ink">{rub(p.amountKopecks)}</td>
                    <td className="px-4 py-2 text-ink-soft">{p.provider}</td>
                    <td className="px-4 py-2">
                      <span className={p.status === "SUCCEEDED" ? "text-green-700" : "text-amber-700"}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.sandbox ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">sandbox</span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">real</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-faint" title={p.createdAt}>
                      {timeAgo(new Date(p.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-base font-bold text-ink">Выплаты продавцам</h2>
          <p className="text-xs text-ink-soft">Последние {payouts.length} записей</p>
        </div>
        {payouts.length === 0 ? (
          <p className="p-6 text-sm text-ink-soft">Выплат пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2">Продавец</th>
                  <th className="px-4 py-2">Сумма</th>
                  <th className="px-4 py-2">Провайдер</th>
                  <th className="px-4 py-2">Статус</th>
                  <th className="px-4 py-2">Режим</th>
                  <th className="px-4 py-2">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-ink">{p.sellerName}</td>
                    <td className="px-4 py-2 font-medium text-ink">{rub(p.amountKopecks)}</td>
                    <td className="px-4 py-2 text-ink-soft">{p.provider}</td>
                    <td className="px-4 py-2">
                      <span className={p.status === "SUCCEEDED" ? "text-green-700" : "text-ink-soft"}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.sandbox ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">sandbox</span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">real</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-faint" title={p.createdAt}>
                      {timeAgo(new Date(p.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
