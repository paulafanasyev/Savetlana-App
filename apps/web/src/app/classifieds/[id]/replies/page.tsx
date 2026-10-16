import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { resolveParams } from "@/lib/page-params";
import { rub, timeAgo } from "@/lib/format";
import { adForReply, listReplies } from "@/lib/domains/classified-replies";
import { listBids } from "@/lib/domains/freelance-bids";
import { serviceOrderForAd } from "@/lib/domains/service-deals";
import { bidSort, daysText, isBidAd, sortBids, type BidSort } from "@/lib/freelance-bids";
import { serviceCustomerNote } from "@/lib/service-deal";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { ChooseBidButton } from "./ChooseBidButton";

export const dynamic = "force-dynamic";

const SORT_LABEL: Record<BidSort, string> = { price: "Дешевле", days: "Быстрее", new: "Новые" };

/** Отклики на объявление: видит только автор. У заказа услуги сверху сделка и предложения исполнителей. */
export default async function ClassifiedRepliesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ sort?: string }>;
}) {
  const { user } = await requireUserServer();
  const { id } = await resolveParams(params);
  const ad = await adForReply(id).catch((e) => {
    if (e instanceof UserFacingError) return null;
    throw e;
  });
  if (!ad || ad.authorId !== user.id) notFound();
  const threads = await listReplies(ad);
  const isJob = ad.vertical === "JOB";
  const bidMode = isBidAd(ad);
  const sort = bidSort(((await searchParams) ?? {}).sort);
  const { bids, chosenId } = bidMode ? await listBids(ad) : { bids: [], chosenId: null };
  const deal = bidMode ? await serviceOrderForAd(ad.id) : null;
  const sorted = sortBids(bids, sort);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <Link href={`/classifieds/${ad.id}`} className="text-sm text-ink-soft hover:text-svetlana-700">← К объявлению</Link>
        <h1 className="mt-1 text-2xl font-semibold">{isJob ? "Отклики" : bidMode ? "Предложения" : "Сообщения"}: {ad.title}</h1>
      </div>

      {deal && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">🛡 Безопасная сделка: заказ {deal.number} на {rub(deal.totalKopecks)}</p>
          <p className="mt-1">{serviceCustomerNote(deal.status) ?? "Статус сделки смотрите на странице заказа."}</p>
          <Link href={`/orders/${deal.id}`} className="btn btn-primary mt-2 inline-block">
            {deal.status === "PAYMENT_PENDING" || deal.status === "CREATED" ? "Оплатить заказ" : "Открыть заказ"}
          </Link>
        </section>
      )}

      {bidMode && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Предложения исполнителей: {bids.length}</h2>
            {bids.length > 1 && (
              <nav className="flex gap-3 text-sm" aria-label="Сортировка предложений">
                {(Object.keys(SORT_LABEL) as BidSort[]).map((s) => (
                  <Link key={s} href={`/classifieds/${ad.id}/replies?sort=${s}`} className={s === sort ? "font-semibold text-svetlana-700" : "text-ink-soft hover:text-svetlana-700"}>
                    {SORT_LABEL[s]}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          {chosenId && !deal && (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Исполнитель выбран. Остальным исполнителям пришло уведомление, новые предложения больше не принимаются.</p>
          )}
          {sorted.length === 0 ? (
            <p className="text-sm text-ink-soft">Предложений пока нет. Когда исполнитель предложит цену и срок, придёт уведомление.</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {sorted.map((b) => (
                <li key={b.applicantId} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">
                        <Link href={`/performers/${b.applicantId}`} className="hover:text-svetlana-700 hover:underline">{b.name}</Link>
                        {b.chosen ? " · ✅ выбран" : ""}
                      </p>
                      <p className="whitespace-pre-line text-sm text-ink-soft">{b.text}</p>
                      <p className="mt-1 text-xs text-ink-faint">
                        {timeAgo(b.createdAt)} ·{" "}
                        <Link href={`/classifieds/${ad.id}/replies/${b.applicantId}`} className="underline">переписка</Link>
                        {" · "}
                        <Link href={`/performers/${b.applicantId}`} className="underline">профиль исполнителя</Link>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold">{rub(b.priceKopecks)}</p>
                      <p className="text-xs text-ink-soft">срок {daysText(b.days)}</p>
                      {!chosenId && <ChooseBidButton classifiedId={ad.id} applicantId={b.applicantId} name={b.name} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {bidMode && threads.length > 0 && <h2 className="text-lg font-semibold">Вся переписка</h2>}
      {threads.length === 0 ? (
        bidMode ? null : <p className="card p-6 text-sm text-ink-soft">{isJob ? "Откликов пока нет. Когда кто-то откликнется, придёт уведомление." : "Сообщений пока нет."}</p>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {threads.map((t) => (
            <li key={t.counterpartId}>
              <Link href={`/classifieds/${ad.id}/replies/${t.counterpartId}`} className="flex items-start justify-between gap-3 p-4 hover:bg-surface-soft">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{t.name}</p>
                  <p className="truncate text-sm text-ink-soft">{t.lastIncoming ? "" : "Вы: "}{t.lastBody}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-ink-faint">
                  <p>{timeAgo(t.lastAt)}</p>
                  {t.unread > 0 && <p className="mt-1 rounded-full bg-svetlana-600 px-2 text-white">{t.unread}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
