import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { kindLabel, loadNotificationCenter, markShownRead } from "@/lib/domains/notification-center";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const ctx = await requireUserServer();
  const { items, unread, unreadMessages } = await loadNotificationCenter(ctx.user.id);
  // Человек открыл раздел и видит эти уведомления: дальше они прочитаны.
  // На этой странице новые ещё подсвечены, при следующем заходе уже нет.
  const shownUnread = items.filter((n) => !n.readAt).map((n) => n.id);
  await markShownRead(ctx.user.id, shownUnread);
  const hiddenUnread = unread - shownUnread.length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-ink">Уведомления</h1>
        {unread > 0 && (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-svetlana-100 px-3 py-1 text-sm font-medium text-svetlana-700">
              новых: {unread}
            </span>
            {hiddenUnread > 0 && (
              <form action="/api/notifications/mark-read" method="POST">
                <button type="submit" className="btn btn-ghost px-3 py-2 text-sm">
                  Отметить остальные {hiddenUnread} прочитанными
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {unreadMessages > 0 && (
        <Link href="/messages" className="card mb-4 flex items-center justify-between gap-3 p-4 hover:shadow-float">
          <span className="text-ink">Новых сообщений: {unreadMessages}. Переписка с магазинами и по объявлениям в разделе «Сообщения».</span>
          <span className="btn btn-ghost shrink-0 px-3 py-2 text-sm">Открыть</span>
        </Link>
      )}

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft">Пока нет уведомлений.</p>
          <p className="mt-2 text-sm text-ink-soft">
            Светлана сообщит о заказах, доставке, снижении цен и важных событиях,
            только о тех, которые вы разрешили. Сообщения от магазинов и отклики на объявления живут в разделе «Сообщения».
          </p>
          <Link href="/privacy" className="btn btn-ghost mt-4 inline-block px-4 py-2 text-sm">
            Настроить уведомления
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li
              key={n.id}
              className={`card p-4 ${n.readAt ? "opacity-70" : "border-svetlana-300 bg-svetlana-50"}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-soft">
                      {kindLabel(n.kind)}
                    </span>
                    {!n.readAt && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-svetlana-600" aria-label="непрочитано" />
                    )}
                  </div>
                  <h3 className="mt-1.5 font-semibold text-ink">{n.title}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{n.body}</p>
                  <time className="mt-2 block text-xs text-ink-soft">{timeAgo(n.createdAt)}</time>
                </div>
                {n.url && (
                  <Link href={n.url} className="btn btn-ghost shrink-0 px-3 py-2 text-sm">
                    Открыть
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
