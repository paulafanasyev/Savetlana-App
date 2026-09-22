import { getAiCallStats, listAiModelCalls } from "@/lib/domains/admin";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const [stats, calls] = await Promise.all([getAiCallStats(), listAiModelCalls()]);

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-base font-bold text-ink">Провайдеры и статусы</h2>
          <p className="text-xs text-ink-soft">
            Стоимость, латентность и ошибки по каждому AI-провайдеру (spec §93).
          </p>
        </div>
        {stats.length === 0 ? (
          <p className="p-6 text-sm text-ink-soft">Вызовов модели пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2">Провайдер</th>
                  <th className="px-4 py-2">Статус</th>
                  <th className="px-4 py-2">Вызовы</th>
                  <th className="px-4 py-2">Средняя задержка</th>
                  <th className="px-4 py-2">Токены (вход)</th>
                  <th className="px-4 py-2">Токены (выход)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.map((s) => (
                  <tr key={`${s.provider}-${s.status}`}>
                    <td className="px-4 py-2 font-medium text-ink">{s.provider}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          s.status === "success" ? "text-green-700" : "font-medium text-red-700"
                        }
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink">{s.calls}</td>
                    <td className="px-4 py-2 text-ink-soft">{s.avgLatencyMs} мс</td>
                    <td className="px-4 py-2 text-ink-soft">{s.tokensIn}</td>
                    <td className="px-4 py-2 text-ink-soft">{s.tokensOut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-base font-bold text-ink">Последние вызовы</h2>
          <p className="text-xs text-ink-soft">
            Содержимое запросов не логируется — только метаданные без секретов (spec §87).
          </p>
        </div>
        {calls.length === 0 ? (
          <p className="p-6 text-sm text-ink-soft">Вызовов пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2">Trace</th>
                  <th className="px-4 py-2">Агент</th>
                  <th className="px-4 py-2">Класс задачи</th>
                  <th className="px-4 py-2">Модель</th>
                  <th className="px-4 py-2">Статус</th>
                  <th className="px-4 py-2">Задержка</th>
                  <th className="px-4 py-2">Класс данных</th>
                  <th className="px-4 py-2">Время</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-mono text-xs text-ink-faint">
                      {c.traceId.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{c.agentName ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{c.taskClass}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{c.model}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          c.status === "success" ? "text-green-700" : "font-medium text-red-700"
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{c.latencyMs} мс</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{c.dataClass}</td>
                    <td className="px-4 py-2 text-ink-soft">{timeAgo(c.createdAt)}</td>
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
