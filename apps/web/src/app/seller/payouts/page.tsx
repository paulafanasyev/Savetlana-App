import { requireSellerServer } from "@/lib/auth";
import { getPayoutProvider, sellerSettlementStatement } from "@/lib/domains/payments";
import { availablePayoutKopecks } from "@/lib/domains/seller-payouts";
import { bankRegistryMode } from "@/lib/domains/payout-registry";
import { bankDetailsSummary } from "@/lib/domains/bank-details";
import { BankDetailsForm } from "./BankDetailsForm";
import { rub, timeAgo } from "@/lib/format";
import { settlementStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

const RESULT_TEXT: Record<string, string> = {
  delivery_required: "Выплата станет доступна, когда заказ будет доставлен покупателю.",
  nothing_to_payout: "Сейчас нечего выплачивать.",
  bank_required: "Выплаты включатся после подключения банка-партнёра. Деньги не пропадут: они числятся за вами.",
  succeeded: "Выплата отправлена.",
  in_progress: "Выплата в обработке у банка.",
  registry_queued: "Выплата запрошена. Площадка переведёт деньги на ваш счёт банковским переводом, обычно в течение 1–2 рабочих дней. Мы сообщим, когда платёж уйдёт.",
  bank_details_required: "Сначала укажите реквизиты для выплат ниже.",
};

export default async function SellerPayoutsPage({ searchParams }: { searchParams?: Promise<{ payout?: string; test?: string }> }) {
  const { sellerId } = await requireSellerServer();
  const [statement, available] = await Promise.all([sellerSettlementStatement(sellerId), availablePayoutKopecks(sellerId)]);
  const params = (await searchParams) ?? {};
  const result = params.payout;
  const registry = bankRegistryMode();
  const sandbox = !registry && getPayoutProvider().sandbox;
  const bank = registry ? await bankDetailsSummary(sellerId) : null;
  const waiting = Math.max(0, statement.totals.pendingKopecks - available);
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Выплаты</h1>
      {sandbox && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Банк для выплат пока не подключён. Расчёты видны, но деньги на счёт не переводятся.</p>
      )}
      {result && (
        <p className="rounded-lg bg-surface-muted p-3 text-sm" role="status">
          {RESULT_TEXT[result] ?? "Запрос на выплату принят."}
          {params.test === "1" && " Тестовый режим: деньги не переводились."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Оборот" value={rub(statement.totals.grossKopecks)} />
        <Stat label="Комиссия площадки" value={rub(statement.totals.platformFeeKopecks)} />
        <Stat label="Доступно к выплате" value={rub(available)} />
        <Stat label="Ждёт доставки" value={rub(waiting)} />
      </div>
      {registry && <BankDetailsForm current={bank} />}
      <form method="post" action="/api/seller/payouts">
        <button className="btn btn-primary" type="submit" disabled={!available || (registry && !bank)}>Запросить выплату {rub(available)}</button>
        {registry && !bank && <p className="mt-1 text-xs text-ink-faint">Кнопка станет активной, когда вы сохраните реквизиты.</p>}
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
      <p className="text-sm text-ink-faint">
        {registry
          ? "Выплата доступна по доставленным заказам. Деньги переводятся банковским переводом на реквизиты выше."
          : "Выплата доступна по доставленным заказам и выполняется банком-партнёром."}
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card p-4"><div className="text-sm text-ink-faint">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}
