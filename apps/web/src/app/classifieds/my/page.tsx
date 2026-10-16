import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { listMyClassifieds } from "@/lib/domains/classifieds";
import { replyCountsByAd } from "@/lib/domains/classified-replies";
import { rub, timeAgo } from "@/lib/format";
import { priceText } from "@/lib/classified-fields";
import { readObject } from "@/lib/db/json";
import { dealTypeLabel, verticalEmoji, verticalLabel } from "@/lib/verticals";
import { canRenew, expiryLabel, isAdActive, RENEW_DAYS } from "@/lib/ad-active";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: string }> = {
  PUBLISHED: { label: "Опубликовано", tone: "bg-emerald-50 text-emerald-800" },
  MODERATION: { label: "На проверке у модератора", tone: "bg-amber-50 text-amber-900" },
  DRAFT: { label: "Черновик", tone: "bg-zinc-100 text-zinc-700" },
  REJECTED: { label: "Отклонено модератором", tone: "bg-red-50 text-red-800" },
  HIDDEN: { label: "Скрыто", tone: "bg-zinc-100 text-zinc-700" },
  SOLD: { label: "Продано", tone: "bg-zinc-100 text-zinc-700" },
  CLOSED: { label: "Закрыто", tone: "bg-zinc-100 text-zinc-700" },
  ARCHIVED: { label: "В архиве", tone: "bg-zinc-100 text-zinc-700" },
};

const EXPIRED = { label: "Срок истёк, не видно в поиске", tone: "bg-amber-50 text-amber-900" };

/** Объявления автора со статусами, сроком действия и откликами. */
export default async function MyClassifiedsPage({ searchParams }: { searchParams?: Promise<{ renewed?: string; renew?: string }> }) {
  const sp = (await searchParams) ?? {};
  const { user } = await requireUserServer();
  const [ads, counts] = await Promise.all([listMyClassifieds(user.id), replyCountsByAd(user.id)]);
  const now = new Date();
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

      {sp.renewed === "1" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">Объявление продлено на {RENEW_DAYS} дней и снова видно в поиске.</p>
      )}
      {sp.renew === "fail" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">Не получилось продлить: это можно сделать только с опубликованным объявлением за 3 дня до конца срока или позже.</p>
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
                  {renewable && (
                    <form action={`/api/classifieds/${ad.id}/renew`} method="POST" className="mt-2">
                      <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
                        Продлить на {RENEW_DAYS} дней
                      </button>
                    </form>
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
