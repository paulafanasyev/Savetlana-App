import { requireSellerServer } from "@/lib/auth";
import { listSellerQuotes } from "@/lib/domains/b2b-quotes";
import { QuoteCard } from "@/components/QuoteCard";
import { SellerQuoteButtons } from "@/components/QuoteActions";

export const dynamic = "force-dynamic";

export default async function SellerQuotesPage() {
  const { sellerId } = await requireSellerServer();
  const quotes = await listSellerQuotes(sellerId);
  return (
    <main className="space-y-4 px-6 py-8">
      <h1 className="text-2xl font-semibold">Коммерческие предложения</h1>
      <p className="text-ink-soft">
        Здесь КП, о которых ваш агент договорился с агентами покупателей в пределах ваших правил торга. Ничего не продаётся без вашего подтверждения: подтвердите КП, и покупатель сможет оформить заказ по этой цене.
      </p>
      {quotes.length === 0 && <p className="rounded-xl border p-5 text-sm">Новых КП нет. Правила, по которым торгуется агент, настраиваются в разделе «Торг B2B».</p>}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q}>
          {q.status === "AWAITING_SELLER" && <SellerQuoteButtons quoteId={q.id} />}
        </QuoteCard>
      ))}
    </main>
  );
}
