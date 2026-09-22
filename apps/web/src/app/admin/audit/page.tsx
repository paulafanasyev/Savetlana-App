import { listAuditLog } from "@/lib/domains/admin";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const logs = await listAuditLog();

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Журнал аудита</h2>
        <p className="text-xs text-ink-soft">
          Каждое чувствительное действие: кто, что, когда, над каким объектом (spec §140).
        </p>
      </div>
      {logs.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Записей аудита пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Действие</th>
                <th className="px-4 py-2">Кто</th>
                <th className="px-4 py-2">Роль</th>
                <th className="px-4 py-2">Объект</th>
                <th className="px-4 py-2">Время</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-mono text-xs font-medium text-ink">{l.action}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                    {(l.actorId ?? "system").slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{l.actorRole ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-faint">
                    {l.targetType}:{(l.targetId ?? "?").slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{timeAgo(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
