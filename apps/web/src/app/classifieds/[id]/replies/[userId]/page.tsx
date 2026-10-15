import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveParams } from "@/lib/page-params";
import { adForReply, loadReplyThread } from "@/lib/domains/classified-replies";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { ClassifiedReplyForm } from "@/components/ClassifiedReplyForm";
import { MessageThread } from "@/components/MessageThread";

export const dynamic = "force-dynamic";

/** Переписка автора объявления с одним откликнувшимся. */
export default async function ClassifiedReplyThreadPage({ params }: { params: Promise<{ id: string; userId: string }> }) {
  const { user } = await requireUserServer();
  const { id, userId } = await resolveParams(params);
  const ad = await adForReply(id).catch((e) => {
    if (e instanceof UserFacingError) return null;
    throw e;
  });
  if (!ad || ad.authorId !== user.id) notFound();
  const applicant = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!applicant) notFound();
  const messages = await loadReplyThread(ad, applicant.id, "author");
  if (messages.length === 0) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <Link href={`/classifieds/${ad.id}/replies`} className="text-sm text-ink-soft hover:text-svetlana-700">
          ← {ad.vertical === "JOB" ? "Все отклики" : "Все сообщения"}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{applicant.name?.trim() || "Без имени"}</h1>
        <p className="text-sm text-ink-soft">По объявлению «{ad.title}». Не просите и не присылайте предоплату, номера карт и коды из СМС.</p>
      </div>
      <section className="card p-4">
        <MessageThread messages={messages} emptyText="Сообщений нет." />
      </section>
      <ClassifiedReplyForm classifiedId={ad.id} applicantId={applicant.id} placeholder="Ваш ответ" />
    </main>
  );
}
