import { requireSellerServer } from "@/lib/auth";
import { sellerSettlementStatement } from "@/lib/domains/payments";
import { rub, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Seller payments & payouts (spec §8, §26).
 *
 * HONESTY NOTE: the settlement *math* is computed here, but the disbursement is
 * executed by the payment partner. In development without a partner key the
 * payout provider is the sandbox one, and every such payout is labelled
 * "sandbox" — it is never presented as real money movement (spec §49).
 */
export default async function SellerPayoutsPage() {
  const { sellerId, user } = await requireSellerServer();
  const statement = await sellerSettlementStatement(sellerId);
  const { totals } = statement;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-ink">Выплаты</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {user.name} · расчёты с платформой
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Сумма заказов" value={rub(totals.grossKopecks)} />
        <Stat
          label="Комиссия платформы"
          value={`− ${rub(totals.platformFeeKopecks)}`}
          hint="1.5% с успешной продажи"
        />
        <Stat
          label="Эквайринг"
          value={`− ${rub(totals.paymentFeeKopecks)}`}
          hint="оплата платёжному партнёру"
        />
        <Stat
          label="Доставка"
          value={`− ${rub(totals.deliveryKopecks)}`}
        />
        <Stat
          label="Корректировки"
          value={totals.adjustmentsKopecks ? `− ${rub(totals.adjustmentsKopecks)}` : "0 ₽"}
          hint="возвраты и удержания"
        />
        <Stat
          label="К выплате"
          value={rub(totals.payoutKopecks)}
          hint={`в ожидании: ${rub(totals.pendingKopecks)}`}
          highlight
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-ink">История расчётов</h2>
        <form action="/api/seller/payouts" method="POST">
          <input
            type="hidden"
            name="idempotencyKey"
            value={`payout:${sellerId}:${Date.now()}`}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={totals.pendingKopecks === 0}
          >
            Запросить выплату {rub(totals.pendingKopecks)}
          </button>
        </form>
      </div>

      {statement.settlements.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-faint">
          Расчётов пока нет. Они появляются после успешной оплаты заказа.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-bg-soft text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Заказ</th>
                <th className="px-3 py-2 font-medium">Сумма</th>
                <th className="px-3 py-2 font-medium">Комиссия</th>
                <th className="px-3 py-2 font-medium">Эквайринг</th>
                <th className="px-3 py-2 font-medium">Доставка</th>
                <th className="px-3 py-2 font-medium">К выплате</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {statement.settlements.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-mono text-xs text-ink-soft">
                    {s.orderId.slice(-8)}
                  </td>
                  <td className="px-3 py-2">{rub(s.grossKopecks)}</td>
                  <td className="px-3 py-2 text-ink-soft">{rub(s.platformFeeKopecks)}</td>
                  <td className="px-3 py-2 text-ink-soft">{rub(s.paymentFeeKopecks)}</td>
                  <td className="px-3 py-2 text-ink-soft">{rub(s.deliveryKopecks)}</td>
                  <td className="px-3 py-2 font-medium">{rub(s.payoutKopecks)}</td>
                  <td className="px-3 py-2">
                    <SettlementStatus status={s.status} />
                  </td>
                  <td className="px-3 py-2 text-ink-faint" title={s.createdAt.toISOString()}>
                    {timeAgo(s.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        Деньги перечисляются платёжным партнёром платформы, а не самой платформой.
        Выплата агрегируется по завершённым расчётам. Если у партнёра нет
        подтверждённой интеграции, используется sandbox-провайдер — такие выплаты
        помечаются как тестовые и не являются реальным движением средств.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-4 ${highlight ? "border-svetlana-400 bg-svetlana-50" : ""}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}

function SettlementStatus({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800",
    AVAILABLE: "bg-blue-100 text-blue-800",
    PAID: "bg-green-100 text-green-800",
    ADJUSTED: "bg-gray-100 text-gray-700",
  };
  const labels: Record<string, string> = {
    PENDING: "Ожидает",
    AVAILABLE: "В обработке",
    PAID: "Выплачено",
    ADJUSTED: "Скорректировано",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}
