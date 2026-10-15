import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUserServer } from "@/lib/auth";
import { resolveParams } from "@/lib/page-params";
import { adForReply, loadReplyThread, replyWording } from "@/lib/domains/classified-replies";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { ClassifiedReplyForm } from "@/components/ClassifiedReplyForm";
import { MessageThread } from "@/components/MessageThread";

export const dynamic = "force-dynamic";

/** Переписка с автором объявления: отклик на вакансию, резюме или вопрос по объявлению. */
export default async function ClassifiedChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUserServer();
  const { id } = await resolveParams(params);
  const ad = await adForReply(id).catch((e) => {
    if (e instanceof UserFacingError) return null;
    throw e;
  });
  if (!ad) notFound();
  if (ad.authorId === user.id) redirect(`/classifieds/${ad.id}/replies`);
  const messages = await loadReplyThread(ad, user.id, "applicant");
  if (ad.status !== "PUBLISHED" && messages.length === 0) notFound();
  const wording = replyWording(ad);
  const isVacancy = ad.vertical === "JOB" && ad.dealType === "VACANCY";
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <Link href={`/classifieds/${ad.id}`} className="text-sm text-ink-soft hover:text-svetlana-700">← К объявлению</Link>
        <h1 className="mt-1 text-2xl font-semibold">{wording.button}: {ad.title}</h1>
        <p className="text-sm text-ink-soft">
          {ad.vertical === "JOB"
            ? "Не платите за обучение, форму или оформление и не отправляйте фото паспорта до собеседования."
            : "Не переводите задаток до встречи и не называйте коды из СМС."}
        </p>
      </div>
      <section className="card p-4">
        <MessageThread
          messages={messages}
          emptyText={isVacancy ? "Расскажите коротко об опыте и когда готовы выйти. Работодателю придёт уведомление." : "Напишите автору: ему придёт уведомление."}
        />
      </section>
      {ad.status === "PUBLISHED" ? (
        <ClassifiedReplyForm
          classifiedId={ad.id}
          initialText={messages.length === 0 && isVacancy ? `Здравствуйте! Хочу откликнуться на вакансию «${ad.title}». ` : ""}
          placeholder={isVacancy ? "Ваш отклик" : "Ваше сообщение"}
        />
      ) : (
        <p className="text-sm text-ink-soft">Объявление снято с публикации, новые сообщения отправить нельзя.</p>
      )}
    </main>
  );
}
