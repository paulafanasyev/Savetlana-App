import Link from "next/link";
import { requireSellerServer } from "@/lib/auth";
import { sellerInbox } from "@/lib/domains/seller-messages";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SellerMessagesPage() {
  const { sellerId } = await requireSellerServer();
  const threads = await sellerInbox(sellerId);
  const unread = threads.reduce((sum, t) => sum + t.unread, 0);
  return (
    <main className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Сообщения</h1>
        <p className="text-ink-soft">
          Вопросы покупателей и ваши ответы. {unread > 0 ? `Без ответа: ${unread}.` : "Все сообщения прочитаны."} Написать покупателю можно из раздела «Покупатели».
        </p>
      </div>
      {threads.length === 0 ? (
        <div className="card p-6">
          <div className="text-lg font-semibold text-ink">Сообщений пока нет</div>
          <p className="mt-2 text-sm text-ink-soft">Покупатели пишут со страницы товара, кнопкой «Задать вопрос продавцу». Когда вопрос придёт, вы получите уведомление. А первым написать можно тем, кто уже покупал у вас.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/seller/customers" className="btn btn-primary">Покупатели</Link>
            <Link href="/seller/products" className="btn btn-ghost">Мои товары</Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {threads.map((t) => (
            <li key={t.counterpartId}>
              <Link href={`/seller/messages/${t.counterpartId}`} className="card block p-4 hover:shadow-float">
                <div className="flex items-center justify-between gap-3">
                  <b>{t.name}</b>
                  <span className="text-xs text-ink-faint">{timeAgo(t.lastAt)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{t.lastIncoming ? "" : "Вы: "}{t.lastBody}</p>
                {t.unread > 0 && <span className="chip mt-2 inline-block bg-amber-50 text-amber-800">ждёт ответа: {t.unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
