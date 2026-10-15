import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { buyerInbox } from "@/lib/domains/seller-messages";
import { classifiedInbox } from "@/lib/domains/classified-inbox";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BuyerMessagesPage() {
  const { user } = await requireUserServer();
  const [threads, adThreads] = await Promise.all([buyerInbox(user.id), classifiedInbox(user.id)]);
  const adUnread = adThreads.reduce((sum, t) => sum + t.unread, 0);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Сообщения</h1>
        <p className="text-ink-soft">Переписка с магазинами и по объявлениям. Задать вопрос продавцу можно на странице любого товара, написать автору объявления можно на странице объявления.</p>
      </div>
      {threads.length === 0 && adThreads.length === 0 ? (
        <div className="card p-6 text-center">
          <div className="text-lg font-semibold text-ink">Сообщений пока нет</div>
          <p className="mt-2 text-sm text-ink-soft">Откройте товар и нажмите «Задать вопрос продавцу»: про размер, комплектацию или доставку. Ответ появится здесь. Сюда же придут отклики на ваши объявления.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/catalog" className="btn btn-primary">Перейти в каталог</Link>
            <Link href="/classifieds" className="btn btn-ghost">Объявления</Link>
            <Link href="/orders" className="btn btn-ghost">Мои заказы</Link>
          </div>
        </div>
      ) : (
        <>
          {threads.length > 0 && (
            <section className="space-y-3">
              {adThreads.length > 0 && <h2 className="text-lg font-semibold">Магазины</h2>}
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
            </section>
          )}
          {adThreads.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">
                Объявления{adUnread > 0 && <span className="chip ml-2 align-middle text-xs">новых: {adUnread}</span>}
              </h2>
              <ul className="space-y-3">
                {adThreads.map((t) => (
                  <li key={t.key}>
                    <Link href={t.href} className="card block p-4 hover:shadow-float">
                      <div className="flex items-center justify-between gap-3">
                        <b>{t.name}</b>
                        <span className="text-xs text-ink-faint">{timeAgo(t.lastAt)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {t.asAuthor ? "Откликнулся на ваше объявление" : "Автор объявления"} «{t.adTitle}»
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{t.lastIncoming ? "" : "Вы: "}{t.lastBody}</p>
                      {t.unread > 0 && <span className="chip mt-2 inline-block">новых: {t.unread}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
