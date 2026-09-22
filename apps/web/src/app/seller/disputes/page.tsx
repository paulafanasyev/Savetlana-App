import { requireSellerServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evidenceUrls, type DisputeStatus } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-red-50 text-red-700",
  EVIDENCE_COLLECTION: "bg-sky-50 text-sky-700",
  RESOLVED_BUYER: "bg-amber-50 text-amber-700",
  RESOLVED_SELLER: "bg-green-50 text-green-700",
  ESCALATED_HUMAN: "bg-purple-50 text-purple-700",
  CLOSED: "bg-slate-100 text-slate-500",
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыт",
  EVIDENCE_COLLECTION: "Сбор доказательств",
  RESOLVED_BUYER: "Решено в пользу покупателя",
  RESOLVED_SELLER: "Решено в пользу продавца",
  ESCALATED_HUMAN: "Передано человеку",
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
 * Disputes where the seller is a party. The seller can respond, concede or
 * escalate — but the final verdict on a judgement-heavy dispute is made by a
 * human arbiter, never by AI (spec §42, §91).
 */
export default async function SellerDisputesPage() {
  const { sellerId } = await requireSellerServer();
  const disputes = await prisma.dispute.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
    include: { order: { include: { items: true } }, buyer: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Споры</h1>

      {disputes.length === 0 ? (
        <div className="card p-10 text-center text-ink-soft">Открытых споров нет.</div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => {
            const closed =
              dispute.status === "RESOLVED_BUYER" ||
              dispute.status === "RESOLVED_SELLER" ||
              dispute.status === "CLOSED";
            return (
              <article key={dispute.id} className="card p-5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className={`chip ${STATUS_STYLES[dispute.status as DisputeStatus] ?? ""}`}>
                    {STATUS_LABEL[dispute.status] ?? dispute.status}
                  </span>
                  <span className="chip">{REASON_LABEL[dispute.reason] ?? dispute.reason}</span>
                  <a
                    href={`/orders/${dispute.orderId}`}
                    className="text-xs font-mono text-svetlana-700 hover:underline"
                  >
                    заказ {dispute.orderId.slice(0, 8)}
                  </a>
                  <span className="ml-auto text-xs text-ink-faint">
                    {new Date(dispute.createdAt).toLocaleDateString("ru-RU")}
                  </span>
                </div>

                <p className="mb-3 text-sm text-ink">{dispute.description}</p>

                {evidenceUrls(dispute).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {evidenceUrls(dispute).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="chip bg-surface-muted text-ink-soft hover:text-svetlana-700"
                      >
                        доказательство
                      </a>
                    ))}
                  </div>
                )}

                {dispute.resolution && (
                  <p className="mb-3 rounded-lg bg-surface-muted p-3 text-sm text-ink-soft">
                    Решение: {dispute.resolution}
                  </p>
                )}

                {!closed && (
                  <form action={`/api/seller/disputes/${dispute.id}`} method="post" className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-ink-faint">Ваш ответ</span>
                      <textarea
                        name="resolution"
                        rows={2}
                        maxLength={4000}
                        placeholder="Опишите ваше предложение решения"
                        className="input w-full"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" name="to" value="RESOLVED_SELLER" className="btn btn-primary">
                        Ответить и предложить решение
                      </button>
                      <button
                        type="submit"
                        name="to"
                        value="ESCALATED_HUMAN"
                        className="btn btn-ghost"
                        formNoValidate
                      >
                        Передать на разбирательство человеку
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
