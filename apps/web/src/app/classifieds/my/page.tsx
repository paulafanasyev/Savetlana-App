import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { listMyClassifieds } from "@/lib/domains/classifieds";
import { replyCountsByAd } from "@/lib/domains/classified-replies";
import { telegramStatus } from "@/lib/domains/telegram-link";
import { rub, timeAgo } from "@/lib/format";
import { priceText } from "@/lib/classified-fields";
import { readObject } from "@/lib/db/json";
import { dealTypeLabel, verticalEmoji, verticalLabel } from "@/lib/verticals";
import { canRenew, expiryLabel, isAdActive, RENEW_DAYS } from "@/lib/ad-active";
import { canClose, canReopen } from "@/lib/ad-status-rules";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: string }> = {
  PUBLISHED: { label: "Опубликовано", tone: "bg-emerald-50 text-emerald-800" },
  MODERATION: { label: "На проверке у модератора", tone: "bg-amber-50 text-amber-900" },
  DRAFT: { label: "Черновик", tone: "bg-zinc-100 text-zinc-700" },
  REJECTED: { label: "Отклонено модератором", tone: "bg-red-50 text-red-800" },
  HIDDEN: { label: "Скрыто", tone: "bg-zinc-100 text-zinc-700" },
  SOLD: { label: "Сделка состоялась", tone: "bg-emerald-50 text-emerald-800" },
  CLOSED: { label: "Снято с публикации", tone: "bg-zinc-100 text-zinc-700" },
  ARCHIVED: { label: "В архиве", tone: "bg-zinc-100 text-zinc-700" },
};

const EXPIRED = { label: "Срок истёк, не видно в поиске", tone: "bg-amber-50 text-amber-900" };

type Notice = { tone: "ok" | "warn" | "bad"; text: string };

/** Итог последнего действия из адреса: продление, снятие, возврат. */
function noticeOf(sp: Record<string, string | undefined>): Notice | null {
  if (sp.renewed === "1") return { tone: "ok", text: `Объявление продлено на ${RENEW_DAYS} дней и снова видно в поиске.` };
  if (sp.renew === "fail") return { tone: "bad", text: "Не получилось продлить: это можно сделать только с опубликованным объявлением за 3 дня до конца срока или позже." };
  if (sp.closed === "deal") return { tone: "ok", text: "Поздравляем со сделкой! Объявление снято с поиска, писать по нему больше не будут." };
  if (sp.closed === "1") return { tone: "ok", text: "Объявление снято с публикации. Его больше не видно в поиске, вернуть можно в любой момент." };
  if (sp.reopened === "1") return { tone: "ok", text: `Объявление снова в поиске на ${RENEW_DAYS} дней.` };
  if (sp.reopened === "review") return { tone: "warn", text: "Объявление отправлено на проверку модератору и появится в поиске после неё." };
  if (sp.status === "fail") return { tone: "bad", text: "Не получилось изменить объявление. Обновите страницу и попробуйте ещё раз." };
  return null;
}

const NOTICE_TONE: Record<Notice["tone"], string> = {
  ok: "bg-emerald-50 text-emerald-800",
  warn: "bg-amber-50 text-amber-900",
  bad: "bg-red-50 text-red-800",
};

/** Объявления автора со статусами, сроком действия и откликами. */
export default async function MyClassifiedsPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const sp = (await searchParams) ?? {};
  const { user } = await requireUserServer();
  const [ads, counts, telegram] = await Promise.all([
    listMyClassifieds(user.id),
    replyCountsByAd(user.id),
    telegramStatus(user.id).catch(() => ({ configured: false, linked: false, botUsername: null })),
  ]);
  const now = new Date();
  const notice = noticeOf(sp);
  // Есть опубликованные объявления, а Telegram не подключён: подсказываем, где включить.
  const suggestTelegram = telegram.configured && !telegram.linked && ads.some((a) => a.status === "PUBLISHED");
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/classifieds" className="text-sm text-zinc-600 hover:underline">← Все объявления</Link>
          <h1 className="mt-1 text-2xl font-bold">Мои объявления</h1>
        </div>
        <Link href="/classifieds/new" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          Разместить объявление
        </Link>
      </div>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-sm ${NOTICE_TONE[notice.tone]}`} role={notice.tone === "bad" ? "alert" : "status"}>{notice.text}</p>
      )}
      {suggestTelegram && (
        <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          Чтобы не пропускать отклики и напоминания о сроке, подключите Telegram в{" "}
          <Link href="/profile" className="font-medium underline">профиле</Link>.
        </p>
      )}

      {ads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center text-zinc-500">
          У вас пока нет объявлений.
        </div>
      ) : (
        <ul className="space-y-3">
          {ads.map((ad) => {
            const published = ad.status === "PUBLISHED";
            const expired = published && !isAdActive(ad.expiresAt, now);
            const status = expired ? EXPIRED : STATUS[ad.status] ?? { label: ad.status, tone: "bg-zinc-100 text-zinc-700" };
            const replies = counts.get(ad.id);
            const cover = ad.images[0]?.url;
            const isJob = ad.vertical === "JOB";
            const term = published && !expired ? expiryLabel(ad.expiresAt, now) : "";
            const renewable = published && canRenew(ad.expiresAt, now);
            const closable = canClose(ad.status);
            const reopenable = canReopen(ad.status);
            return (
              <li key={ad.id} className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt={ad.title} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-2xl">{verticalEmoji(ad.vertical)}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className={`rounded px-2 py-0.5 font-medium ${status.tone}`}>{status.label}</span>
                    <span>{verticalLabel(ad.vertical)} · {dealTypeLabel(ad.dealType)}</span>
                    {term && <span>{term}</span>}
                  </div>
                  {published ? (
                    <Link href={`/classifieds/${ad.id}`} className="font-semibold hover:underline">{ad.title}</Link>
                  ) : (
                    <p className="font-semibold">{ad.title}</p>
                  )}
                  <p className="text-sm text-zinc-600">
                    {ad.priceKopecks > 0 ? priceText(ad.dealType, readObject(ad.attrs), rub(ad.priceKopecks)) : isJob ? "Зарплата по договорённости" : "Цена не указана"}
                    {" · "}{ad.city.name} · {ad.views} просмотров · {timeAgo(ad.createdAt)}
                  </p>
                  {ad.status === "MODERATION" && (
                    <p className="mt-1 text-xs text-amber-900">Пока модератор не проверит объявление, его не видно в поиске. Обычно это занимает до суток.</p>
                  )}
                  {(renewable || closable || reopenable) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {renewable && (
                        <form action={`/api/classifieds/${ad.id}/renew`} method="POST">
                          <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
                            Продлить на {RENEW_DAYS} дней
                          </button>
                        </form>
                      )}
                      {reopenable && (
                        <form action={`/api/classifieds/${ad.id}/close?do=reopen`} method="POST">
                          <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
                            Вернуть в поиск
                          </button>
                        </form>
                      )}
                      {closable && published && (
                        <form action={`/api/classifieds/${ad.id}/close?do=close&reason=deal`} method="POST">
                          <button type="submit" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                            Сделка состоялась
                          </button>
                        </form>
                      )}
                      {closable && (
                        <form action={`/api/classifieds/${ad.id}/close?do=close`} method="POST">
                          <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium">
                            Снять с публикации
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <Link href={`/classifieds/${ad.id}/replies`} className="text-sm font-medium text-zinc-900 hover:underline">
                    {isJob ? "Отклики" : "Сообщения"}: {replies?.threads ?? 0}
                  </Link>
                  {replies && replies.unread > 0 && (
                    <p className="mt-1 rounded-full bg-red-600 px-2 text-xs text-white">новых {replies.unread}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
