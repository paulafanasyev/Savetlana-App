import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { resolveParams } from "@/lib/page-params";
import { timeAgo } from "@/lib/format";
import { adForReply, listReplies } from "@/lib/domains/classified-replies";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Отклики на объявление: видит только автор. */
export default async function ClassifiedRepliesPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUserServer();
  const { id } = await resolveParams(params);
  const ad = await adForReply(id).catch((e) => {
    if (e instanceof UserFacingError) return null;
    throw e;
  });
  if (!ad || ad.authorId !== user.id) notFound();
  const threads = await listReplies(ad);
  const isJob = ad.vertical === "JOB";
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <Link href={`/classifieds/${ad.id}`} className="text-sm text-ink-soft hover:text-svetlana-700">← К объявлению</Link>
        <h1 className="mt-1 text-2xl font-semibold">{isJob ? "Отклики" : "Сообщения"}: {ad.title}</h1>
      </div>
      {threads.length === 0 ? (
        <p className="card p-6 text-sm text-ink-soft">{isJob ? "Откликов пока нет. Когда кто-то откликнется, придёт уведомление." : "Сообщений пока нет."}</p>
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
