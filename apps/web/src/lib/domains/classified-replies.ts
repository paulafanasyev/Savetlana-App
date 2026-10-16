/**
 * Отклики на объявления: на вакансию, резюме и любое другое объявление.
 *
 * Как и переписка с магазином (seller-messages.ts), сообщения хранятся как
 * уведомления, отдельная таблица и миграция не нужны. Ветка переписки:
 * откликнувшийся → автор: kind = classified_reply, userId = автор,
 *   url = /classifieds/<id>/replies/<откликнувшийся>
 * автор → откликнувшийся: kind = classified_answer, userId = откликнувшийся,
 *   url = /classifieds/<id>/chat
 *
 * Автор отвечает только тем, кто откликнулся сам: написать первым по своему
 * объявлению нельзя. Каждое сообщение проходит антифрод (message-guard.ts).
 * Предложения исполнителей по заказу услуги (freelance-bids.ts) идут тем же путём.
 */
import { prisma } from "../prisma";
import { UserFacingError, buildInbox, cleanMessage } from "./engagement-rules";
import { notify } from "./notifications";
import { guardOutgoingMessage, warnRecipient } from "./message-guard";
import { BID_MARK } from "../freelance-bids";

const THREAD_HOURLY_LIMIT = 20;
const SENDER_HOURLY_LIMIT = 30;

export const authorThreadUrl = (classifiedId: string, applicantId: string) => `/classifieds/${classifiedId}/replies/${applicantId}`;
export const applicantThreadUrl = (classifiedId: string) => `/classifieds/${classifiedId}/chat`;

export interface ReplyMessage {
  id: string;
  body: string;
  createdAt: Date;
  mine: boolean;
}

interface AdForReply {
  id: string;
  title: string;
  authorId: string;
  status: string;
  vertical: string;
  dealType: string;
}

/** Что написать на кнопке и в заголовке уведомления. */
export function replyWording(ad: { vertical: string; dealType: string }): { button: string; incoming: string } {
  if (ad.vertical === "JOB" && ad.dealType === "VACANCY") return { button: "Откликнуться", incoming: "Отклик на вакансию" };
  if (ad.vertical === "JOB" && ad.dealType === "RESUME") return { button: "Предложить работу", incoming: "Предложение работы по резюме" };
  if (ad.vertical === "SERVICE" && ad.dealType === "SERVICE_REQUEST") return { button: "Задать вопрос заказчику", incoming: "Сообщение по заказу" };
  return { button: "Написать автору", incoming: "Сообщение по объявлению" };
}

export async function adForReply(classifiedId: string): Promise<AdForReply> {
  const ad = await prisma.classified.findUnique({
    where: { id: classifiedId },
    select: { id: true, title: true, authorId: true, status: true, vertical: true, dealType: true },
  });
  if (!ad) throw new UserFacingError("Объявление не найдено", 404);
  return ad;
}

async function sentLastHour(where: Record<string, unknown>): Promise<number> {
  return prisma.notification.count({ where: { ...where, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
}

/** Отклик или вопрос автору объявления. */
export async function sendToAuthor(sender: { id: string; name: string | null }, classifiedId: string, raw: unknown): Promise<void> {
  const text = cleanMessage(raw);
  const ad = await adForReply(classifiedId);
  if (ad.authorId === sender.id) throw new UserFacingError("Это ваше объявление: писать самому себе не нужно", 400);
  if (ad.status !== "PUBLISHED") throw new UserFacingError("Объявление снято с публикации, отправить отклик нельзя", 409);
  const url = authorThreadUrl(ad.id, sender.id);
  if ((await sentLastHour({ userId: ad.authorId, kind: "classified_reply", url })) >= THREAD_HOURLY_LIMIT) {
    throw new UserFacingError("Слишком много сообщений подряд. Дождитесь ответа автора", 429);
  }
  if ((await sentLastHour({ kind: "classified_reply", url: { endsWith: `/replies/${sender.id}` } })) >= SENDER_HOURLY_LIMIT) {
    throw new UserFacingError("Слишком много откликов за час. Попробуйте позже", 429);
  }
  const verdict = await guardOutgoingMessage(sender.id, text);
  const incoming = text.startsWith(BID_MARK) ? "Предложение по заказу" : replyWording(ad).incoming;
  await notify({
    userId: ad.authorId,
    kind: "classified_reply",
    title: `${incoming} «${ad.title.slice(0, 80)}» от ${sender.name?.trim() || "пользователя без имени"}`,
    body: text,
    url,
  });
  await warnRecipient(ad.authorId, verdict, url);
}

/** Ответ автора тому, кто откликнулся. */
export async function sendToApplicant(authorId: string, classifiedId: string, applicantId: string, raw: unknown): Promise<void> {
  const text = cleanMessage(raw);
  const ad = await adForReply(classifiedId);
  if (ad.authorId !== authorId) throw new UserFacingError("Отвечать на отклики может только автор объявления", 403);
  const wrote = await prisma.notification.findFirst({
    where: { userId: ad.authorId, kind: "classified_reply", url: authorThreadUrl(ad.id, applicantId) },
    select: { id: true },
  });
  if (!wrote) throw new UserFacingError("Ответить можно только тому, кто сам откликнулся на объявление", 403);
  const url = applicantThreadUrl(ad.id);
  if ((await sentLastHour({ userId: applicantId, kind: "classified_answer", url })) >= THREAD_HOURLY_LIMIT) {
    throw new UserFacingError("Слишком много сообщений подряд. Дождитесь ответа", 429);
  }
  const verdict = await guardOutgoingMessage(authorId, text);
  await notify({
    userId: applicantId,
    kind: "classified_answer",
    title: `Ответ по объявлению «${ad.title.slice(0, 80)}»`,
    body: text,
    url,
  });
  await warnRecipient(applicantId, verdict, url);
}

/** Переписка автора с одним откликнувшимся. Входящие помечаются прочитанными. */
export async function loadReplyThread(ad: { id: string; authorId: string }, applicantId: string, viewer: "author" | "applicant"): Promise<ReplyMessage[]> {
  const fromApplicant = { userId: ad.authorId, kind: "classified_reply", url: authorThreadUrl(ad.id, applicantId) };
  const fromAuthor = { userId: applicantId, kind: "classified_answer", url: applicantThreadUrl(ad.id) };
  const rows = await prisma.notification.findMany({
    where: { OR: [fromApplicant, fromAuthor] },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, body: true, createdAt: true, kind: true },
  });
  const incoming = viewer === "author" ? fromApplicant : fromAuthor;
  await prisma.notification.updateMany({ where: { ...incoming, readAt: null }, data: { readAt: new Date() } });
  return rows.reverse().map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, mine: r.kind !== incoming.kind }));
}

/** Все откликнувшиеся на объявление, свежие сверху. */
export async function listReplies(ad: { id: string; authorId: string }) {
  const prefix = `/classifieds/${ad.id}/replies/`;
  const rows = await prisma.notification.findMany({
    where: {
      OR: [
        { userId: ad.authorId, kind: "classified_reply", url: { startsWith: prefix } },
        { kind: "classified_answer", url: applicantThreadUrl(ad.id) },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { userId: true, kind: true, url: true, body: true, createdAt: true, readAt: true },
  });
  const inbox = buildInbox(
    rows
      .map((r) => ({
        counterpartId: r.kind === "classified_reply" ? (r.url ?? "").slice(prefix.length) : r.userId,
        body: r.body,
        createdAt: r.createdAt,
        incoming: r.kind === "classified_reply",
        read: Boolean(r.readAt),
      }))
      .filter((r) => r.counterpartId)
  );
  const users = await prisma.user.findMany({ where: { id: { in: inbox.map((t) => t.counterpartId) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name?.trim() || "Без имени"]));
  return inbox.filter((t) => names.has(t.counterpartId)).map((t) => ({ ...t, name: names.get(t.counterpartId) as string }));
}

/** Сколько у автора откликов по каждому объявлению: переписок всего и непрочитанных сообщений. */
export async function replyCountsByAd(authorId: string): Promise<Map<string, { threads: number; unread: number }>> {
  const rows = await prisma.notification.findMany({
    where: { userId: authorId, kind: "classified_reply" },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { url: true, readAt: true },
  });
  const seen = new Map<string, Set<string>>();
  const out = new Map<string, { threads: number; unread: number }>();
  for (const r of rows) {
    const m = /^\/classifieds\/([^/]+)\/replies\/([^/]+)$/.exec(r.url ?? "");
    if (!m) continue;
    const adId = m[1] as string;
    const applicantId = m[2] as string;
    const people = seen.get(adId) ?? new Set<string>();
    seen.set(adId, people);
    people.add(applicantId);
    const c = out.get(adId) ?? { threads: 0, unread: 0 };
    c.threads = people.size;
    if (!r.readAt) c.unread += 1;
    out.set(adId, c);
  }
  return out;
}
