import Link from "next/link";
import { requireAdminServer } from "@/lib/auth";
import { getDisputeCase } from "@/lib/domains/disputes";
import { assessDisputeBuyer } from "@/lib/domains/dispute-screening";
import { rub } from "@/lib/format";

export const dynamic = "force-dynamic";

const REASON_CODES = [
  { code: "ITEM_NOT_RECEIVED", label: "Товар не получен" },
  { code: "ITEM_NOT_AS_DESCRIBED", label: "Не соответствует описанию" },
  { code: "ITEM_DAMAGED", label: "Товар повреждён" },
  { code: "PAYMENT_DISPUTE", label: "Спор по оплате" },
  { code: "RETURN_DISPUTE", label: "Спор по возврату" },
  { code: "DELIVERY_DISPUTE", label: "Спор по доставке" },
];

/**
 * Moderator's case file. The verdict is recorded with a reason code and an
 * optional refund amount; refunds move money through the payment provider,
 * never through an arbitrary AI decision (spec §42, §91).
 */
export default async function AdminDisputeCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminServer();
  const { id } = await params;
  const dispute = await getDisputeCase(id, "admin", "admin");
  if (!dispute) {
    return (
      <div className="card p-10 text-center text-ink-soft">
        Дело не найдено.{" "}
        <Link href="/admin/disputes" className="text-svetlana-700 hover:underline">
          Назад к очереди
        </Link>
      </div>
    );
  }

  const closed =
    dispute.status === "RESOLVED_BUYER" ||
    dispute.status === "RESOLVED_SELLER" ||
    dispute.status === "CLOSED";
  const orderTotal = dispute.order.items.reduce(
    (sum, i) => sum + (i.priceKopecks ?? 0) * (i.quantity ?? 1),
    0,
  );
  // Сигналы злоупотребления спорами: только для модератора.
  const risk = await assessDisputeBuyer(dispute.id).catch(() => null);

  return (
    <div className="space-y-6">
      <Link href="/admin/disputes" className="text-sm text-ink-faint hover:underline">
        ← К очереди споров
      </Link>

      <header className="card p-6">
        <h1 className="text-xl font-bold text-ink">Дело {dispute.id.slice(0, 8)}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="chip bg-surface-muted">Покупатель: {dispute.buyer.name ?? "не указан"}</span>
          <span className="chip bg-surface-muted">Продавец: {dispute.sellerProfile.displayName}</span>
          <span className="chip bg-surface-muted">Сумма заказа: {rub(orderTotal)}</span>
          {dispute.slaBreached && (
            <span className="chip bg-amber-50 text-amber-700">⏱ SLA ответа нарушен</span>
          )}
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{dispute.description}</p>
        {dispute.resolution && (
          <p className="mt-3 rounded-lg bg-surface-muted p-3 text-sm text-ink-soft">
            Решение: {dispute.resolution}
          </p>
        )}
      </header>

      <section className={`card p-6 ${risk && risk.level !== "low" ? "border-amber-300 bg-amber-50" : ""}`}>
        <h2 className="mb-2 text-lg font-semibold text-ink">Антифрод: история покупателя</h2>
        {!risk ? (
          <p className="text-sm text-ink-soft">Не удалось посчитать.</p>
        ) : risk.level === "low" ? (
          <p className="text-sm text-ink-soft">Признаков злоупотребления спорами и возвратами нет.</p>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium text-amber-900">
              {risk.level === "high" ? "Высокий риск злоупотребления" : "Есть признаки злоупотребления"}. Это не
              повод отказать автоматически: проверьте факты доставки и доказательства.
            </p>
            <ul className="space-y-1 text-sm text-amber-900">
              {risk.signals.map((s) => (
                <li key={s.code}>• {s.text}</li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 text-xs text-ink-faint">Покупатель и продавец этот блок не видят.</p>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">Доказательства</h2>
        {dispute.evidence.length === 0 ? (
          <p className="text-sm text-ink-soft">Файлы не прикреплены.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {dispute.evidence.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg bg-surface-muted p-3"
              >
                <span className="flex-1 truncate text-ink">{e.fileName ?? e.storageKey}</span>
                <span
                  className={`text-xs ${e.verified ? "text-emerald-600" : "text-amber-600"}`}
                >
                  {e.verified ? "проверен" : "на проверке"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">Переписка (включая внутреннее)</h2>
        {dispute.messages.length === 0 ? (
          <p className="text-sm text-ink-soft">Сообщений нет.</p>
        ) : (
          <ul className="space-y-3">
            {dispute.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg p-3 text-sm ${
                  m.isInternal ? "bg-amber-50 text-amber-900" : "bg-surface-muted"
                }`}
              >
                <div className="mb-1 flex gap-2 text-xs text-ink-faint">
                  <b className="text-ink">{m.authorRole}</b>
                  <span>{new Date(m.createdAt).toLocaleString("ru-RU")}</span>
                  {m.isInternal && <span>· внутреннее</span>}
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!closed && (
        <section className="card p-6">
          <h2 className="mb-4 text-lg font-semibold text-ink">Вынести решение</h2>
          <form action={`/api/admin/disputes/${dispute.id}`} method="post" className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-faint">Код причины</span>
              <select name="reasonCode" className="input w-full">
                {REASON_CODES.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-faint">Решение (обоснование)</span>
              <textarea
                name="resolution"
                rows={3}
                maxLength={4000}
                required
                placeholder="Почему решение именно такое"
                className="input w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-faint">
                Возврат покупателю (₽, необязательно)
              </span>
              <input
                name="refundRub"
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                className="input w-full"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="action" value="resolve_buyer" className="btn btn-primary">
                Решить в пользу покупателя
              </button>
              <button
                type="submit"
                name="action"
                value="resolve_seller"
                className="btn btn-ghost"
              >
                Решить в пользу продавца
              </button>
              <button
                type="submit"
                name="action"
                value="assign"
                formNoValidate
                className="btn btn-ghost"
              >
                Взять дело в работу
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
