import { registryPayerFromEnv, registryRows, bankRegistryMode, paymentPurpose } from "@/lib/domains/payout-registry";
import { rub, timeAgo } from "@/lib/format";
import { RegistryActions } from "./RegistryActions";

export const dynamic = "force-dynamic";

/**
 * Выплаты продавцам переводом со счёта площадки. Администратор выгружает
 * реестр, платит в интернет-банке и отмечает каждую выплату по платёжке.
 */
export default async function AdminPayoutsPage() {
  const rows = await registryRows();
  const payerReady = Boolean(registryPayerFromEnv());
  const total = rows.reduce((s, r) => s + r.amountKopecks, 0);
  return (
    <div className="space-y-5">
      {!bankRegistryMode() && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Выплаты по реестру выключены. Чтобы продавцы могли запрашивать выплаты на свои реквизиты, задайте PAYOUT_MODE=bank_registry.
        </p>
      )}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Ждут перевода: {rows.length}</h2>
            <p className="text-sm text-ink-soft">На сумму {rub(total)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-ghost" href="/api/admin/payouts/registry?format=csv">Скачать реестр (Excel)</a>
            {payerReady ? (
              <a className="btn btn-primary" href="/api/admin/payouts/registry?format=1c">Файл для банка (1С)</a>
            ) : (
              <span className="text-xs text-ink-faint">Файл для банка появится, когда заданы реквизиты счёта площадки (PAYOUT_PAYER_*).</span>
            )}
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>Скачайте файл для банка и загрузите его в интернет-банк: «Импорт платёжек из 1С».</li>
          <li>Подпишите и отправьте платёжки.</li>
          <li>Отметьте каждую выплату номером платёжки. Продавец получит уведомление.</li>
        </ol>
      </section>

      {rows.length === 0 ? (
        <p className="card p-6 text-sm text-ink-soft">Выплат, ждущих перевода, нет.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <article key={r.payoutId} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-ink">{r.sellerName}</b>
                <span className="text-lg font-semibold">{rub(r.amountKopecks)}</span>
              </div>
              {r.details ? (
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  <div><dt className="inline text-ink-faint">Получатель: </dt><dd className="inline">{r.details.recipientName}</dd></div>
                  <div><dt className="inline text-ink-faint">ИНН: </dt><dd className="inline font-mono">{r.details.inn}{r.details.kpp ? ` / КПП ${r.details.kpp}` : ""}</dd></div>
                  <div><dt className="inline text-ink-faint">Банк: </dt><dd className="inline">{r.details.bankName}, БИК <span className="font-mono">{r.details.bik}</span></dd></div>
                  <div><dt className="inline text-ink-faint">Счёт: </dt><dd className="inline font-mono">{r.details.account}</dd></div>
                  <div className="sm:col-span-2"><dt className="inline text-ink-faint">Назначение: </dt><dd className="inline">{paymentPurpose(r)}</dd></div>
                </dl>
              ) : (
                <p className="text-sm text-bad">Реквизиты не читаются (сменился ключ шифрования?). Отметьте возврат, продавец запросит выплату заново.</p>
              )}
              <p className="text-xs text-ink-faint">Запрошена {timeAgo(r.createdAt)} · выплата {r.payoutId.slice(-8)}</p>
              <RegistryActions payoutId={r.payoutId} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
