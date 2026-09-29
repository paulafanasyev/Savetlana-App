import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { DisputeStatus } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-red-50 text-red-700",
  EVIDENCE_COLLECTION: "bg-sky-50 text-sky-700",
  RESOLVED_BUYER: "bg-emerald-50 text-emerald-700",
  RESOLVED_SELLER: "bg-amber-50 text-amber-700",
  ESCALATED_HUMAN: "bg-purple-50 text-purple-700",
  CLOSED: "bg-slate-100 text-slate-500",
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыт",
  EVIDENCE_COLLECTION: "Сбор доказательств",
  RESOLVED_BUYER: "Решено в вашу пользу",
  RESOLVED_SELLER: "Решено в пользу продавца",
  ESCALATED_HUMAN: "Передано модерации",
  CLOSED: "Закрыт",
};
const REASON_LABEL: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Товар не получен",
  ITEM_NOT_AS_DESCRIBED: "Не соответствует описанию",
  ITEM_DAMAGED: "Товар повреждён",
  PAYMENT_DISPUTE: "Спор по оплате",
  RETURN_DISPUTE: "Спор по возврату",
  DELIVERY_DISPUTE: "Спор по доставке",
};

/**
 * Buyer-facing dispute list. Each case links to the full Dispute Center page
 * (messages, evidence, timeline, appeal) — spec §42.
 */
export default async function MyDisputesPage() {
  const { user } = await requireUserServer();
  const disputes = await prisma.dispute.findMany({
    where: { buyerId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      order: { include: { items: true } },
      sellerProfile: { select: { displayName: true } },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Мои споры</h1>
      <p className="mt-1 text-sm text-slate-500">
        Доказательства, переписка и хронология сохраняются по каждому случаю.
      </p>

      {disputes.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          Открытых споров нет.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {disputes.map((dispute) => {
            const title =
              dispute.order.items[0]?.titleSnapshot ?? `Заказ ${dispute.orderId.slice(0, 8)}`;
            return (
              <Link
                key={dispute.id}
                href={`/disputes/${dispute.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-sky-300"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      STATUS_STYLES[dispute.status as DisputeStatus] ?? ""
                    }`}
                  >
                    {STATUS_LABEL[dispute.status] ?? dispute.status}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    {REASON_LABEL[dispute.reason] ?? dispute.reason}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {new Date(dispute.createdAt).toLocaleDateString("ru-RU")}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-900">{title}</p>
                <p className="mt-1 text-sm text-slate-500">
                  Продавец: {dispute.sellerProfile.displayName}
                </p>
                {dispute.resolution && (
                  <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    Решение: {dispute.resolution}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
