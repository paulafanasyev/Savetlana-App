import { requireSellerServer } from "@/lib/auth";
import { sellerSettlementStatement } from "@/lib/domains/payments";
import { rub, timeAgo } from "@/lib/format";
import { settlementStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

const RESULT_TEXT: Record<string, string> = {
  delivery_required: "Выплата будет доступна, когда все оплаченные заказы будут доставлены покупателям.",
  nothing_to_payout: "Сейчас нечего выплачивать.",
};

export default async function SellerPayoutsPage({ searchParams }: { searchParams?: Promise<{ payout?: string }> }) {
  const { sellerId } = await requireSellerServer();
  const statement = await sellerSettlementStatement(sellerId);
  const result = (await searchParams)?.payout;
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Выплаты</h1>
      {result && <p className="rounded-lg bg-surface-muted p-3 text-sm" role="status">{RESULT_TEXT[result] ?? "Запрос на выплату принят."}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Оборот" value={rub(statement.totals.grossKopecks)} />
        <Stat label="Комиссия площадки" value={rub(statement.totals.platformFeeKopecks)} />
        <Stat label="К выплате" value={rub(statement.totals.pendingKopecks)} />
      </div>
      <form method="post" action="/api/seller/payouts">
        <button className="btn btn-primary" type="submit" disabled={!statement.totals.pendingKopecks}>Запросить выплату {rub(statement.totals.pendingKopecks)}</button>
      </form>
      <div className="card overflow-x-auto">
        <h2 className="p-4 text-lg font-semibold">История расчётов</h2>
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b"><th className="p-3">Заказ</th><th className="p-3">Сумма</th><th className="p-3">К выплате</th><th className="p-3">Статус</th><th className="p-3">Дата</th></tr></thead>
          <tbody>
            {statement.settlements.map((settlement) => (
              <tr className="border-b" key={settlement.id}>
                <td className="p-3">{settlement.orderId.slice(-8)}</td>
                <td className="p-3">{rub(settlement.grossKopecks)}</td>
                <td className="p-3">{rub(settlement.payoutKopecks)}</td>
                <td className="p-3">{settlementStatusLabel(settlement.status)}</td>
                <td className="p-3">{timeAgo(settlement.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {statement.settlements.length === 0 && <p className="p-4 text-ink-faint">Расчётов пока нет.</p>}
      </div>
      <p className="text-sm text-ink-faint">Выплата доступна после доставки заказа и выполняется платёжным партнёром.</p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card p-4"><div className="text-sm text-ink-faint">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}
