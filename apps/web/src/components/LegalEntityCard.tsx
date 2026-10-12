import { getLegalEntity, LEGAL_LABELS, missingLegalFields, type LegalField } from "@/lib/legal";

/** Блок реквизитов площадки. Пустые поля показываются честно, без выдумок. */
export function LegalEntityCard() {
  const entity = getLegalEntity();
  const missing = new Set<LegalField>(missingLegalFields(entity));
  const fields = Object.keys(LEGAL_LABELS) as LegalField[];

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
