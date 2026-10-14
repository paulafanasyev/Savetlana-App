import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { INN_STATUS_LABEL, sellerInnReport } from "@/lib/domains/seller-inn-report";

export const dynamic = "force-dynamic";

const STATUS_CLASS = {
  OK: "bg-green-100 text-green-800",
  MISSING: "bg-red-100 text-red-800",
  INVALID: "bg-amber-100 text-amber-800",
} as const;

/** ИНН продавцов для чеков 54-ФЗ: кто готов, у кого ИНН нет или с ошибкой. */
export default async function AdminReceiptsInnPage() {
  const { user } = await requireUserServer();
  if (user.role !== "ADMIN") return null;
  const report = await sellerInnReport();

  return (
    <section className="space-y-4">
      <div className="card space-y-2 p-4">
        <h2 className="text-base font-bold text-ink">Чеки 54-ФЗ: ИНН продавцов</h2>
        {report.agentReceipts ? (
          <p className="text-sm text-ink-soft">
            Агентский чек <b>включён</b>: продавцы без верного ИНН сейчас не могут торговать.
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            Агентский чек <b>выключен</b> (RECEIPT_AGENT_TYPE не задан). После включения продавцы из списка ниже перестанут
            торговать, пока не исправят ИНН. Предупредите их заранее.
          </p>
        )}
        <p className="text-sm text-ink">
          С проблемой ИНН: <b>{report.problems}</b>
          {report.tradingProblems > 0 ? <>, из них сейчас торгуют: <b>{report.tradingProblems}</b></> : null}
        </p>
      </div>

      <div className="card overflow-hidden">
        {report.rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-soft">Продавцов пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2">Продавец</th>
                  <th className="px-4 py-2">Тип</th>
                  <th className="px-4 py-2">ИНН</th>
                  <th className="px-4 py-2">Состояние</th>
                  <th className="px-4 py-2">Товары в продаже</th>
                  <th className="px-4 py-2">Аккаунт</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-ink">{r.displayName}</div>
                      <div className="text-xs text-ink-faint">{r.email}</div>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{r.sellerType}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                      {r.inn ?? "—"}
                      {r.source === "company" ? <div className="font-sans text-ink-faint">юрлицо</div> : null}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[r.status]}`}>{INN_STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{r.activeProducts}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{r.isActivated ? "активен" : "не активирован"}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/sellers/${r.id}`} className="text-xs text-svetlana-700 hover:underline">
                        профиль →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
