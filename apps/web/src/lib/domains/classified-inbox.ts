/**
 * Отклики на объявления в общем разделе «Сообщения».
 *
 * Сами сообщения живут в classified-replies.ts (как уведомления). Здесь
 * они собираются в список переписок для одного человека в обеих ролях:
 * автор объявления видит каждого откликнувшегося отдельной перепиской,
 * откликнувшийся видит одну переписку с автором по каждому объявлению.
 */
import { prisma } from "../prisma";
import { buildInbox, type InboxRow } from "./engagement-rules";
import { applicantThreadUrl, authorThreadUrl } from "./classified-replies";

export interface ReplyRow {
  userId: string;
  kind: string;
  url: string | null;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface ReplyThreadRef {
  /** Ключ переписки: объявление + собеседник. */
  key: string;
  adId: string;
  /** Откликнувшийся (для автора) или null: собеседник откликнувшегося это автор объявления. */
  applicantId: string | null;
  href: string;
  incoming: boolean;
}

const REPLY_URL = /^\/classifieds\/([^/]+)\/replies\/([^/]+)$/;
const CHAT_URL = /^\/classifieds\/([^/]+)\/chat$/;

/** Чья это переписка и куда вести человека `me`. Чужие строки отбрасываются. */
export function replyThreadRef(row: ReplyRow, me: string, myAdIds: Set<string>): ReplyThreadRef | null {
  const url = row.url ?? "";
  if (row.kind === "classified_reply") {
    const m = REPLY_URL.exec(url);
    if (!m) return null;
    const adId = m[1] as string;
    const applicantId = m[2] as string;
    if (row.userId === me && applicantId !== me) {
      // Мне, автору, написал откликнувшийся.
      return { key: `${adId}:${applicantId}`, adId, applicantId, href: authorThreadUrl(adId, applicantId), incoming: true };
    }
    if (applicantId === me && row.userId !== me) {
      // Я откликнулся на чужое объявление.
      return { key: `${adId}:author`, adId, applicantId: null, href: applicantThreadUrl(adId), incoming: false };
    }
    return null;
  }
  if (row.kind === "classified_answer") {
    const m = CHAT_URL.exec(url);
    if (!m) return null;
    const adId = m[1] as string;
    if (row.userId === me && !myAdIds.has(adId)) {
      // Автор ответил на мой отклик.
      return { key: `${adId}:author`, adId, applicantId: null, href: applicantThreadUrl(adId), incoming: true };
    }
    if (myAdIds.has(adId) && row.userId !== me) {
      // Я, автор, ответил откликнувшемуся.
      return { key: `${adId}:${row.userId}`, adId, applicantId: row.userId, href: authorThreadUrl(adId, row.userId), incoming: false };
    }
    return null;
  }
  return null;
}

export interface ClassifiedInboxThread {
  key: string;
  href: string;
  adTitle: string;
  name: string;
  /** true: я автор объявления и мне откликнулись. */
  asAuthor: boolean;
  lastBody: string;
  lastAt: Date;
  lastIncoming: boolean;
  unread: number;
}

/** Все переписки по объявлениям для человека, свежие сверху. */
export async function classifiedInbox(userId: string): Promise<ClassifiedInboxThread[]> {
  const myAds = await prisma.classified.findMany({ where: { authorId: userId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 500 });
  const myAdIds = new Set(myAds.map((a) => a.id));
  const rows = await prisma.notification.findMany({
    where: {
      OR: [
        { userId, kind: { in: ["classified_reply", "classified_answer"] } },
        { kind: "classified_reply", url: { endsWith: `/replies/${userId}` } },
        ...(myAdIds.size ? [{ kind: "classified_answer", url: { in: [...myAdIds].map(applicantThreadUrl) } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { userId: true, kind: true, url: true, body: true, createdAt: true, readAt: true },
  });

  const refs = new Map<string, ReplyThreadRef>();
  const inboxRows: InboxRow[] = [];
  for (const row of rows) {
    const ref = replyThreadRef(row, userId, myAdIds);
    if (!ref) continue;
    if (!refs.has(ref.key)) refs.set(ref.key, ref);
    inboxRows.push({ counterpartId: ref.key, body: row.body, createdAt: row.createdAt, incoming: ref.incoming, read: Boolean(row.readAt) });
  }
  const threads = buildInbox(inboxRows).slice(0, 100);
  if (!threads.length) return [];

  const adIds = [...new Set(threads.map((t) => refs.get(t.counterpartId)?.adId).filter(Boolean))] as string[];
  const ads = await prisma.classified.findMany({ where: { id: { in: adIds } }, select: { id: true, title: true, authorId: true } });
  const adById = new Map(ads.map((a) => [a.id, a]));
  const peopleIds = new Set<string>();
  for (const t of threads) {
    const ref = refs.get(t.counterpartId);
    const ad = ref ? adById.get(ref.adId) : undefined;
    if (!ref || !ad) continue;
    peopleIds.add(ref.applicantId ?? ad.authorId);
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...peopleIds] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name?.trim() || "Без имени"]));

  const out: ClassifiedInboxThread[] = [];
  for (const t of threads) {
    const ref = refs.get(t.counterpartId);
    const ad = ref ? adById.get(ref.adId) : undefined;
    if (!ref || !ad) continue;
    const name = names.get(ref.applicantId ?? ad.authorId);
    if (!name) continue;
    out.push({
      key: ref.key,
      href: ref.href,
      adTitle: ad.title,
      name,
      asAuthor: ref.applicantId !== null,
      lastBody: t.lastBody,
      lastAt: t.lastAt,
      lastIncoming: t.lastIncoming,
      unread: t.unread,
    });
  }
  return out;
}
