import { listRiskEvents } from "@/lib/domains/admin";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<string, string> = {
  LOW: "text-ink-soft",
  MEDIUM: "text-amber-700",
  HIGH: "text-orange-700",
  REVIEW: "text-blue-700",
  BLOCKED: "text-red-700",
};

export default async function AdminRiskPage() {
  const events = await listRiskEvents();

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="text-base font-bold text-ink">Risk-события</h2>
        <p className="text-xs text-ink-soft">
          Каждое решение администратора записывается в аудит. Просмотрённое событие нельзя
          переоткрыть.
        </p>
      </div>
      {events.length === 0 ? (
        <p className="p-6 text-sm text-ink-soft">Risk-событий пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2">Уровень</th>
                <th className="px-4 py-2">Правило</th>
                <th className="px-4 py-2">Описание</th>
                <th className="px-4 py-2">Объект</th>
                <th className="px-4 py-2">Действие</th>
                <th className="px-4 py-2">Создан</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2">
                    <span className={`font-bold ${LEVEL_TONE[e.level] ?? "text-ink-soft"}`}>
                      {e.level}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">{e.ruleId}</td>
                  <td className="max-w-xs px-4 py-2 text-ink-soft">{e.description}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-faint">
                    {e.actorType}:{e.actorId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {e.actionTaken ? (
                      <span>{e.actionTaken}</span>
                    ) : (
                      <span className="text-amber-700">не рассмотрено</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{timeAgo(e.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    {e.reviewedAt ? (
                      <span className="text-xs text-ink-faint">закрыто</span>
                    ) : (
                      <form action={`/api/admin/risk/${e.id}`} method="POST">
                        <input type="hidden" name="decision" value="reviewed_by_admin" />
                        <button type="submit" className="btn btn-ghost text-xs">
                          Отметить рассмотренным
                        </button>
                      </form>
                    )}
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
