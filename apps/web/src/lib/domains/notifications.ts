/**
 * Notification Center (spec §67, §109).
 *
 * Svetlana is proactive only where the user has allowed it, and never creates
 * artificial urgency or hidden advertising (spec §110, §111).
 */
import { prisma } from "../prisma";
import { audit } from "./audit";

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
  | "ai_note";

export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
}

export async function notify(input: NotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      url: input.url,
    },
  });
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
