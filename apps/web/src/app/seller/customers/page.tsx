import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { sellerCustomerReport, SEGMENT_LABELS, type CustomerSegment } from "@/lib/domains/seller-crm";
import { rub, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEGMENT_STYLE: Record<CustomerSegment, string> = {
  VIP: "bg-amber-100 text-amber-900",
  REGULAR: "bg-green-100 text-green-900",
  NEW: "bg-sky-100 text-sky-900",
  SLEEPING: "bg-rose-100 text-rose-900",
  ONE_TIME: "bg-surface-muted text-ink-soft",
};

export default async function SellerCustomersPage({ searchParams }: { searchParams: Promise<{ segment?: string }> }) {
  const { sellerId } = await requireSellerServer();
  const { segment } = await searchParams;
  const report = await sellerCustomerReport(sellerId);
  const active = segment && segment in SEGMENT_LABELS ? (segment as CustomerSegment) : null;
  const list = active ? report.customers.filter((c) => c.segment === active) : report.customers;
  const maxMonth = Math.max(1, ...report.months.map((m) => m.revenueKopecks));

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Покупатели</h1>
        <p className="text-ink-soft">Кто у вас покупает, кто возвращается и кого стоит вернуть. Считается по оплаченным заказам.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Покупателей" value={String(report.totals.customers)} hint={`повторно купили: ${report.totals.repeatCustomers}`} />
        <Stat label="Возвращаются" value={`${report.totals.repeatRatePercent}%`} hint="доля повторных покупателей" />
        <Stat label="Средний чек" value={rub(report.totals.avgCheckKopecks)} />
        <Stat label="Ценность покупателя" value={rub(report.totals.avgCustomerValueKopecks)} hint="выручка на одного покупателя" />
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Выручка за 6 месяцев</h2>
        <div className="mt-4 flex h-40 items-end gap-3" role="img" aria-label="Выручка по месяцам">
          {report.months.map((m) => (
            <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-[11px] text-ink-faint">{m.revenueKopecks > 0 ? rub(m.revenueKopecks) : ""}</div>
              <div className="w-full rounded-t bg-svetlana-500" style={{ height: `${Math.max(2, Math.round((m.revenueKopecks / maxMonth) * 110))}px` }} title={`${m.orders} заказов`} />
              <div className="text-xs text-ink-soft">{m.label}</div>
            </div>
          ))}
        </div>
      </section>

      {report.advice.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">Советы Светланы</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{report.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href="/seller/promotions" className="text-svetlana-700 hover:underline">Запустить скидку →</Link>
            <Link href="/seller/messages" className="text-svetlana-700 hover:underline">Сообщения покупателей →</Link>
          </div>
        </section>
      )}

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Сегменты">
        <Link href="/seller/customers" className={`rounded-full px-3 py-1 ${!active ? "bg-ink text-white" : "border"}`}>Все · {report.totals.customers}</Link>
        {(Object.keys(SEGMENT_LABELS) as CustomerSegment[]).map((s) => (
          <Link key={s} href={`/seller/customers?segment=${s}`} className={`rounded-full px-3 py-1 ${active === s ? "bg-ink text-white" : "border"}`}>{SEGMENT_LABELS[s]} · {report.segments[s]}</Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <p className="text-ink-faint">{report.totals.customers === 0 ? "Покупателей пока нет. Они появятся после первых оплаченных заказов." : "В этом сегменте пока никого."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-faint">
              <tr><th className="py-2 pr-4">Покупатель</th><th className="pr-4">Сегмент</th><th className="pr-4">Заказов</th><th className="pr-4">Сумма</th><th className="pr-4">Средний чек</th><th className="pr-4">Последний заказ</th><th className="pr-4">Чаще берёт</th><th><span className="sr-only">Связь</span></th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.buyerId} className="border-t">
                  <td className="py-2 pr-4"><div className="font-medium">{c.name}</div><div className="text-xs text-ink-faint">{c.emailMasked}</div></td>
                  <td className="pr-4"><span className={`rounded-full px-2 py-0.5 text-xs ${SEGMENT_STYLE[c.segment]}`}>{SEGMENT_LABELS[c.segment]}</span></td>
                  <td className="pr-4">{c.ordersCount}</td>
                  <td className="pr-4">{rub(c.totalKopecks)}</td>
                  <td className="pr-4">{rub(c.avgCheckKopecks)}</td>
                  <td className="pr-4">{timeAgo(c.lastOrderAt)}</td>
                  <td className="pr-4">{c.favoriteProduct ?? "—"}</td>
                  <td><Link href={`/seller/messages/${c.buyerId}`} className="text-svetlana-700 hover:underline">Написать</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}
