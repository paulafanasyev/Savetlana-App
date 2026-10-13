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
        <div className="card p-6 text-center">
          <div className="text-lg font-semibold text-ink">Сообщений пока нет</div>
          <p className="mt-2 text-sm text-ink-soft">Откройте товар и нажмите «Задать вопрос продавцу»: про размер, комплектацию или доставку. Ответ появится здесь.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/catalog" className="btn btn-primary">Перейти в каталог</Link>
            <Link href="/orders" className="btn btn-ghost">Мои заказы</Link>
          </div>
        </div>
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
