import Link from "next/link";
import { requireAdminServer } from "@/lib/auth";
import { listAdminDisputeQueue } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыт",
  EVIDENCE_COLLECTION: "Сбор доказательств",
  RESOLVED_BUYER: "В пользу покупателя",
  RESOLVED_SELLER: "В пользу продавца",
  ESCALATED_HUMAN: "Передано модерации",
  CLOSED: "Закрыт",
};

/**
 * Admin Dispute Center queue. Moderators assign cases to themselves and resolve
 * them with a reason code; SLA breaches are surfaced for the decision (spec §42).
 */
export default async function AdminDisputesPage() {
  await requireAdminServer();
  const disputes = await listAdminDisputeQueue();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Споры</h1>

      {disputes.length === 0 ? (
        <div className="card p-10 text-center text-ink-soft">Очередь споров пуста.</div>
      ) : (
        <div className="space-y-4">
          {disputes.map((d) => (
            <article key={d.id} className="card p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="chip bg-surface-muted">
                  {STATUS_LABEL[d.status] ?? d.status}
                </span>
                <Link
                  href={`/admin/disputes/${d.id}`}
                  className="font-mono text-xs text-svetlana-700 hover:underline"
                >
                  дело {d.id.slice(0, 8)}
                </Link>
                <span className="text-xs text-ink-faint">
                  покупатель {d.buyer.name ?? "—"} · продавец {d.sellerProfile.displayName}
                </span>
                {d.slaBreached && (
                  <span className="chip bg-amber-50 text-amber-700">⏱ SLA нарушен</span>
                )}
                <span className="ml-auto text-xs text-ink-faint">
                  {new Date(d.createdAt).toLocaleDateString("ru-RU")}
                </span>
              </div>
              <p className="text-sm text-ink">{d.description}</p>
              <div className="mt-3 flex gap-2">
                {d.assignedAdmin ? (
                  <span className="chip bg-emerald-50 text-emerald-700">
                    назначен {d.assignedAdmin.name ?? "модератор"}
                  </span>
                ) : (
                  <span className="chip bg-amber-50 text-amber-700">не назначен</span>
                )}
                <Link
                  href={`/admin/disputes/${d.id}`}
                  className="btn btn-ghost btn-sm"
                >
                  Открыть дело
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
