import Link from "next/link";
import type { Quote } from "@/lib/domains/b2b-quotes";

/** Ссылки на документы по КП: договор сразу, счёт и УПД после заказа. */
export function QuoteDocLinks({ quote }: { quote: Pick<Quote, "id" | "status"> }) {
  if (quote.status === "DECLINED" || quote.status === "EXPIRED") return null;
  const docs: { kind: string; label: string }[] = [{ kind: "contract", label: quote.status === "AWAITING_SELLER" ? "Проект договора" : "Договор поставки" }];
  if (quote.status === "ORDERED") docs.push({ kind: "invoice", label: "Счёт" }, { kind: "upd", label: "УПД" });
  return (
    <p className="text-sm">
      <span className="text-ink-soft">Документы: </span>
      {docs.map((d, i) => (
        <span key={d.kind}>
          {i > 0 && " · "}
          <Link className="text-blue-900 underline" href={`/quotes/${quote.id}/documents/${d.kind}`}>
            {d.label}
          </Link>
        </span>
      ))}
    </p>
  );
}
