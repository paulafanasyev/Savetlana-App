/**
 * Notification Center (spec §67, §109).
 *
 * Svetlana is proactive only where the user has allowed it, and never creates
 * artificial urgency or hidden advertising (spec §110, §111).
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { deliverNotification } from "../notification-delivery";

export type NotificationKind =
  | "order_status"
  | "delivery_update"
  | "price_drop"
  | "availability_confirmed"
  | "gift_event"
  | "relationship_request"
  | "document_status"
  | "dispute_update"
  | "review_reply"
  | "reminder"
  | "listing_expiring"
  | "ai_note"
  // Переписка покупателя и продавца (см. seller-messages.ts)
  | "seller_message"
  | "buyer_message"
  // Продавцу: товар заканчивается или закончился (см. stock-alerts.ts)
  | "stock_low"
  // Безопасность аккаунта: сброс пароля, подтверждение почты, смена реквизитов.
  // Это служебные письма, не реклама: согласие на рассылку для них не нужно.
  | "security"
  // Продавцу: выплата отправлена или вернулась
  | "payout_update";

export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
}

export interface NotifyOptions {
  /**
   * Дождаться отправки письма до ответа. На хостинге вроде Vercel работа после
   * ответа может быть оборвана, и письмо так и не уйдёт. Включать для писем,
   * без которых человек не войдёт (сброс пароля, подтверждение почты).
   */
  awaitDelivery?: boolean;
}

export async function notify(input: NotificationInput, options: NotifyOptions = {}): Promise<void> {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      url: input.url,
    },
  });
  // Out-of-band delivery (email/push). Failures here must never break the
  // in-app notification — the delivery layer records its own honest status.
  const delivery = deliverNotification(notification).catch(() => {
    /* delivery failure is recorded in NotificationDelivery, not raised */
  });
  if (options.awaitDelivery) await delivery;
}

export async function notifyMany(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await prisma.notification.createMany({
    data: inputs.map((i) => ({
      userId: i.userId,
      kind: i.kind,
      title: i.title.slice(0, 200),
      body: i.body.slice(0, 1000),
      url: i.url,
    })),
  });
}

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 40, 100),
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  await audit({
    actorId: userId,
    actorRole: "user",
    action: "notifications.read_all",
    targetType: "notification",
  });
}
