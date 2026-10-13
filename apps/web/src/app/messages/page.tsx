import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { buyerInbox } from "@/lib/domains/seller-messages";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BuyerMessagesPage() {
  const { user } = await requireUserServer();
  const threads = await buyerInbox(user.id);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Сообщения</h1>
        <p className="text-ink-soft">Переписка с магазинами. Задать вопрос продавцу можно на странице любого товара.</p>
      </div>
      {threads.length === 0 ? (
        <p className="text-ink-faint">Сообщений пока нет.</p>
      ) : (
        <ul className="space-y-3">
          {threads.map((t) => (
            <li key={t.counterpartId}>
              <Link href={`/messages/${t.counterpartId}`} className="card block p-4 hover:shadow-float">
                <div className="flex items-center justify-between gap-3">
                  <b>{t.name}</b>
                  <span className="text-xs text-ink-faint">{timeAgo(t.lastAt)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{t.lastIncoming ? "" : "Вы: "}{t.lastBody}</p>
                {t.unread > 0 && <span className="chip mt-2 inline-block">новых: {t.unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
