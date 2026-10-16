import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { listBuyerQuotes, ordersForQuotes } from "@/lib/domains/b2b-quotes";
import { QuoteCard } from "@/components/QuoteCard";
import { AcceptQuoteButton } from "@/components/QuoteActions";

export const dynamic = "force-dynamic";

export default async function BuyerQuotesPage() {
  const { user } = await requireUserServer();
  const quotes = await listBuyerQuotes(user.id);
  const orders = await ordersForQuotes(quotes.filter((q) => q.status === "ORDERED").map((q) => q.id));
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Мои КП</h1>
      <p className="text-ink-soft">
        Коммерческие предложения, о которых договорились агенты. Продавец подтверждает КП, после этого вы оформляете заказ по цене КП и оплачиваете его как обычно: деньги у площадки, пока вы не получите товар.
      </p>
      {quotes.length === 0 && (
        <p className="rounded-xl border p-5 text-sm">
          КП пока нет. Найдите товар через Светлану и напишите, например: «Поторгуйся за первый: 100 штук, хочу по 800 ₽, максимум 900».
        </p>
      )}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q}>
          {q.status === "SELLER_CONFIRMED" && <AcceptQuoteButton quoteId={q.id} />}
          {q.status === "ORDERED" && orders[q.id] && (
            <Link className="text-sm text-blue-900 underline" href={`/orders/${orders[q.id]}`}>
              Перейти к заказу
            </Link>
          )}
        </QuoteCard>
      ))}
    </main>
  );
}
