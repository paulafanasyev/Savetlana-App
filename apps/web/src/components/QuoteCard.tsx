import type { ReactNode } from "react";
import { QUOTE_STATUS_LABEL, type Quote } from "@/lib/domains/b2b-quotes";
import type { CheckStatus, CounterpartyReport } from "@/lib/domains/counterparty-check";

const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;

const MARK: Record<CheckStatus, { icon: string; cls: string; label: string }> = {
  OK: { icon: "✓", cls: "text-green-800", label: "пройдено" },
  WARN: { icon: "!", cls: "text-amber-800", label: "внимание" },
  FAIL: { icon: "✗", cls: "text-red-800", label: "не пройдено" },
  UNKNOWN: { icon: "?", cls: "text-ink-soft", label: "не проверено" },
};

const VERDICT_CLS: Record<CounterpartyReport["verdict"], string> = {
  RECOMMENDED: "border-green-700 bg-green-50",
  CAUTION: "border-amber-600 bg-amber-50",
  NOT_RECOMMENDED: "border-red-700 bg-red-50",
};

export function CounterpartyPanel({ report }: { report: CounterpartyReport }) {
  return (
    <details className={`rounded-lg border p-3 text-sm ${VERDICT_CLS[report.verdict]}`}>
      <summary className="cursor-pointer font-medium">Проверка продавца «{report.displayName}»: {report.verdictText}</summary>
      <ul className="mt-2 space-y-1">
        {report.checks.map((c) => (
          <li key={c.id}>
            <span className={`font-semibold ${MARK[c.status].cls}`} aria-label={MARK[c.status].label}>
              {MARK[c.status].icon}
            </span>{" "}
            <strong>{c.title}</strong>: {c.detail}. <span className="text-xs text-ink-soft">Источник: {c.source}.</span>{" "}
            {c.url && (
              <a className="text-xs text-blue-900 underline" href={c.url} target="_blank" rel="noopener noreferrer">
                открыть
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function QuoteCard({ quote, counterparty, children }: { quote: Quote; counterparty?: CounterpartyReport | null; children?: ReactNode }) {
  return (
    <article className="space-y-2 rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {quote.number} · «{quote.title}»
        </h2>
        <span className="text-sm text-ink-soft">{QUOTE_STATUS_LABEL[quote.status]}</span>
      </div>
      <p className="text-sm">
        {quote.quantity} шт. по <strong>{rub(quote.unitPriceKopecks)}</strong> вместо {rub(quote.listPriceKopecks)} (скидка {String(quote.discountPercent).replace(".", ",")}%), итого <strong>{rub(quote.totalKopecks)}</strong>.
      </p>
      {quote.termsLines && quote.termsLines.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {quote.termsLines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {quote.payment === "DEFERRAL" && (
        <p className="text-xs text-ink-soft">Отсрочку платежа продавец даёт по договору поставки. На площадке заказ сейчас оплачивается через безопасную сделку; отсрочка заработает, когда подключим партнёра по отложенной оплате.</p>
      )}
      {quote.chain && <p className="text-xs text-ink-soft">{quote.chain}</p>}
      {counterparty && <CounterpartyPanel report={counterparty} />}
      <p className="text-xs text-ink-soft">Действует до {quote.expiresAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}. Цена в каталоге не меняется: она действует только по этому КП.</p>
      {children}
    </article>
  );
}
