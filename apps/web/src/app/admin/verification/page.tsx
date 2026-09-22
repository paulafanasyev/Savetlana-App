import { listVerificationQueue } from "@/lib/domains/admin";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const IDENTITY_KINDS = ["identity", "business", "npd"] as const;

export default async function AdminVerificationPage() {
  const sellers = await listVerificationQueue();

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Очередь верификации продавцов</h2>
        <p className="text-xs text-ink-soft">
          Ручная проверка помечается как manual_review и никогда не выдаётся за официальную проверку
          ЕСИА/ФНС (spec §49).
        </p>
      </div>
      {sellers.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Активированных продавцов пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Продавец</th>
                <th className="px-4 py-2">Тип</th>
                <th className="px-4 py-2">ИИН/ОГРН</th>
                <th className="px-4 py-2">Личность</th>
                <th className="px-4 py-2">Бизнес</th>
                <th className="px-4 py-2">НПД</th>
                <th className="px-4 py-2">Документы</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sellers.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium text-ink">{s.displayName}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{s.sellerType}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                    {s.inn || "—"}
                    {s.ogrn ? ` / ${s.ogrn}` : ""}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <StatusBadge status={s.identityStatus} />
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <StatusBadge status={s.businessStatus} />
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <StatusBadge status={s.npdStatus} />
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {s._count.verificationRecords} проверок · {s._count.documents} документов
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {IDENTITY_KINDS.map((kind) => (
                        <form
                          key={kind}
                          action={`/api/admin/verification/${s.id}`}
                          method="POST"
                          className="flex gap-1"
                        >
                          <input type="hidden" name="kind" value={kind} />
                          <button
                            type="submit"
                            name="approved"
                            value="true"
                            className="btn btn-ghost px-2 py-0.5 text-xs"
                            title="Одобрить (ручная проверка)"
                          >
                            ✓
                          </button>
                          <button
                            type="submit"
                            name="approved"
                            value="false"
                            className="btn px-2 py-0.5 text-xs text-red-700"
                            title="Отклонить"
                          >
                            ✗
                          </button>
                        </form>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-faint">—</span>;
  const tone =
    status === "VERIFIED"
      ? "text-green-700"
      : status === "REJECTED"
        ? "text-red-700"
        : status === "PENDING"
          ? "text-amber-700"
          : "text-ink-soft";
  return <span className={`font-medium ${tone}`}>{status}</span>;
}
