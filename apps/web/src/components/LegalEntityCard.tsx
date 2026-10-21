import { getLegalEntity, LEGAL_LABELS, missingLegalFields, type LegalField } from "@/lib/legal";

/**
 * Блок реквизитов площадки. Пустые поля показываются честно, без выдумок.
 * Пока оператор не зарегистрирован совсем, вместо таблицы из шести одинаковых
 * «будет указано» один понятный абзац о том, в каком режиме работает сайт.
 */
export function LegalEntityCard() {
  const entity = getLegalEntity();
  const missing = new Set<LegalField>(missingLegalFields(entity));
  const fields = Object.keys(LEGAL_LABELS) as LegalField[];

  if (missing.size >= fields.length) {
    return (
      <section className="card p-5" data-testid="legal-pending">
        <h2 className="text-base font-bold text-ink">Реквизиты</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          АИКО сейчас работает в демонстрационном режиме: магазины и объявления на сайте
          примеры, деньги не списываются. Наименование оператора, ИНН, ОГРН, адрес, почта и телефон
          поддержки появятся здесь до запуска настоящей оплаты.
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Автор и правообладатель проекта: <span className="font-medium text-ink">Афанасьев Павел Петрович</span>.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5">
      <h2 className="text-base font-bold text-ink">Реквизиты</h2>
      <dl className="mt-3 divide-y divide-surface-line text-sm">
        {fields.map((field) => (
          <div key={field} className="flex justify-between gap-4 py-2.5">
            <dt className="text-ink-soft">{LEGAL_LABELS[field]}</dt>
            <dd className={missing.has(field) ? "text-right text-amber-700" : "text-right text-ink"}>
              {entity[field] && !missing.has(field) ? entity[field] : "будет указано после регистрации"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
