/**
 * Переписка покупателя и продавца.
 *
 * Сообщения хранятся как уведомления (таблица Notification), поэтому
 * отдельная таблица и миграция базы не нужны, а получатель сразу видит
 * сообщение в уведомлениях и получает письмо. Ветка переписки определяется
 * адресом уведомления:
 *   продавец → покупатель: kind = seller_message, userId = покупатель, url = /messages/<sellerId>
 *   покупатель → продавец: kind = buyer_message, userId = пользователь продавца, url = /seller/messages/<buyerId>
 */
import { prisma } from "../prisma";
import { UserFacingError, cleanMessage, buildInbox } from "./engagement-rules";
import { notify } from "./notifications";

const HOURLY_LIMIT = 30;

export const buyerThreadUrl = (sellerId: string) => `/messages/${sellerId}`;
export const sellerThreadUrl = (buyerId: string) => `/seller/messages/${buyerId}`;

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: Date;
  /** true, если сообщение написал тот, кто сейчас смотрит переписку. */
  mine: boolean;
}

async function sellerOrThrow(sellerId: string) {
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerId }, select: { id: true, userId: true, displayName: true } });
  if (!seller) throw new UserFacingError("Магазин не найден", 404);
  return seller;
}

async function sentLastHour(where: { userId?: string; kind: string; url?: string }): Promise<number> {
  return prisma.notification.count({ where: { ...where, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
}

/** Продавец может написать покупателю, если тот у него заказывал или уже писал ему сам. */
export async function sellerCanWrite(sellerId: string, sellerUserId: string, buyerId: string): Promise<boolean> {
  const order = await prisma.order.findFirst({ where: { sellerId, buyerId }, select: { id: true } });
  if (order) return true;
  const wrote = await prisma.notification.findFirst({ where: { userId: sellerUserId, kind: "buyer_message", url: sellerThreadUrl(buyerId) }, select: { id: true } });
  return Boolean(wrote);
}

export async function sendBuyerToSeller(buyer: { id: string; name: string | null }, sellerId: string, raw: unknown): Promise<void> {
  const text = cleanMessage(raw);
  const seller = await sellerOrThrow(sellerId);
  if (seller.userId === buyer.id) throw new UserFacingError("Это ваш магазин: писать самому себе не нужно", 400);
  if ((await sentLastHour({ userId: seller.userId, kind: "buyer_message", url: sellerThreadUrl(buyer.id) })) >= HOURLY_LIMIT) {
    throw new UserFacingError("Слишком много сообщений подряд. Дождитесь ответа продавца", 429);
  }
  await notify({
    userId: seller.userId,
    kind: "buyer_message",
    title: `Сообщение от покупателя ${buyer.name?.trim() || "без имени"}`,
    body: text,
    url: sellerThreadUrl(buyer.id),
  });
}

export async function sendSellerToBuyer(sellerId: string, buyerId: string, raw: unknown): Promise<void> {
  const text = cleanMessage(raw);
  const seller = await sellerOrThrow(sellerId);
  const buyer = await prisma.user.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) throw new UserFacingError("Покупатель не найден", 404);
  if (!(await sellerCanWrite(seller.id, seller.userId, buyerId))) {
    throw new UserFacingError("Написать можно покупателю, который у вас заказывал или сам вам написал", 403);
  }
  if ((await sentLastHour({ userId: buyerId, kind: "seller_message", url: buyerThreadUrl(seller.id) })) >= HOURLY_LIMIT) {
    throw new UserFacingError("Слишком много сообщений подряд. Дождитесь ответа покупателя", 429);
  }
  await notify({
    userId: buyerId,
    kind: "seller_message",
    title: `Сообщение от магазина «${seller.displayName}»`,
    body: text,
    url: buyerThreadUrl(seller.id),
  });
}

/** Переписка покупателя с магазином. viewer определяет, какие сообщения «мои», и что пометить прочитанным. */
export async function loadThread(sellerId: string, buyerId: string, viewer: "buyer" | "seller"): Promise<ThreadMessage[]> {
  const seller = await sellerOrThrow(sellerId);
  const rows = await prisma.notification.findMany({
    where: {
      OR: [
        { userId: buyerId, kind: "seller_message", url: buyerThreadUrl(seller.id) },
        { userId: seller.userId, kind: "buyer_message", url: sellerThreadUrl(buyerId) },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, body: true, createdAt: true, kind: true },
  });
  const incomingKind = viewer === "buyer" ? "seller_message" : "buyer_message";
  await prisma.notification.updateMany({
    where:
      viewer === "buyer"
        ? { userId: buyerId, kind: incomingKind, url: buyerThreadUrl(seller.id), readAt: null }
        : { userId: seller.userId, kind: incomingKind, url: sellerThreadUrl(buyerId), readAt: null },
    data: { readAt: new Date() },
  });
  return rows.reverse().map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, mine: r.kind !== incomingKind }));
}

export async function sellerInbox(sellerId: string) {
  const seller = await sellerOrThrow(sellerId);
  const rows = await prisma.notification.findMany({
    where: { OR: [{ userId: seller.userId, kind: "buyer_message" }, { kind: "seller_message", url: buyerThreadUrl(seller.id) }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { userId: true, kind: true, url: true, body: true, createdAt: true, readAt: true },
  });
  const inbox = buildInbox(
    rows.map((r) => ({
      counterpartId: r.kind === "buyer_message" ? (r.url ?? "").replace("/seller/messages/", "") : r.userId,
      body: r.body,
      createdAt: r.createdAt,
      incoming: r.kind === "buyer_message",
      read: Boolean(r.readAt),
    }))
  );
  const users = await prisma.user.findMany({ where: { id: { in: inbox.map((t) => t.counterpartId) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name?.trim() || "Покупатель"]));
  return inbox.filter((t) => names.has(t.counterpartId)).map((t) => ({ ...t, name: names.get(t.counterpartId) as string }));
}

export async function buyerInbox(buyerId: string) {
  const rows = await prisma.notification.findMany({
    where: { OR: [{ userId: buyerId, kind: "seller_message" }, { kind: "buyer_message", url: sellerThreadUrl(buyerId) }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { userId: true, kind: true, url: true, body: true, createdAt: true, readAt: true },
  });
  const sellerUserIds = [...new Set(rows.filter((r) => r.kind === "buyer_message").map((r) => r.userId))];
  const byUser = await prisma.sellerProfile.findMany({ where: { userId: { in: sellerUserIds } }, select: { id: true, userId: true } });
  const sellerByUser = new Map(byUser.map((s) => [s.userId, s.id]));
  const inbox = buildInbox(
    rows
      .map((r) => ({
        counterpartId: r.kind === "seller_message" ? (r.url ?? "").replace("/messages/", "") : sellerByUser.get(r.userId) ?? "",
        body: r.body,
        createdAt: r.createdAt,
        incoming: r.kind === "seller_message",
        read: Boolean(r.readAt),
      }))
      .filter((r) => r.counterpartId)
  );
  const sellers = await prisma.sellerProfile.findMany({ where: { id: { in: inbox.map((t) => t.counterpartId) } }, select: { id: true, displayName: true } });
  const names = new Map(sellers.map((s) => [s.id, s.displayName]));
  return inbox.filter((t) => names.has(t.counterpartId)).map((t) => ({ ...t, name: names.get(t.counterpartId) as string }));
}
