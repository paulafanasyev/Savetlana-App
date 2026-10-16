import type { ReactNode } from "react";
import { QUOTE_STATUS_LABEL, type Quote } from "@/lib/domains/b2b-quotes";

const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;

export function QuoteCard({ quote, children }: { quote: Quote; children?: ReactNode }) {
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
      {quote.chain && <p className="text-xs text-ink-soft">{quote.chain}</p>}
      <p className="text-xs text-ink-soft">Действует до {quote.expiresAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}. Цена в каталоге не меняется: она действует только по этому КП.</p>
      {children}
    </article>
  );
}
