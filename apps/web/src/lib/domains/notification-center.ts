/**
 * Раздел «Уведомления»: всё, кроме переписки.
 *
 * Сообщения тоже хранятся как уведомления, но читаются в «Сообщениях» и в
 * кабинете продавца: там переписка помечается прочитанной, когда человек её
 * открыл. Поэтому здесь сообщения не показываем и кнопкой «Отметить все
 * прочитанными» их не трогаем, иначе новое сообщение потерялось бы, так и
 * не прочитанное.
 *
 * Остальные уведомления помечаются прочитанными, когда человек открыл
 * раздел и увидел их.
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { INBOX_MESSAGE_KINDS, SELLER_MESSAGE_KINDS } from "../unread";

export const MESSAGE_KINDS: string[] = [...INBOX_MESSAGE_KINDS, ...SELLER_MESSAGE_KINDS];

const KIND_LABEL: Record<string, string> = {
  order_status: "Заказ",
  delivery_update: "Доставка",
  price_drop: "Снижение цены",
  availability_confirmed: "Наличие подтверждено",
  gift_event: "Подарок",
  relationship_request: "Запрос связи",
  document_status: "Документ",
  dispute_update: "Спор",
  review_reply: "Ответ на отзыв",
  reminder: "Напоминание",
  listing_expiring: "Размещение истекает",
  ai_note: "Светлана",
  stock_low: "Остатки",
  security: "Безопасность",
  payout_update: "Выплата",
  seller_message: "Сообщение",
  buyer_message: "Сообщение покупателя",
  classified_reply: "Отклик",
  classified_answer: "Ответ по объявлению",
};

/** Подпись вида уведомления по-русски. Неизвестный вид не показываем латиницей. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Уведомление";
}

const PAGE_SIZE = 50;

export async function loadNotificationCenter(userId: string) {
  const notMessage = { userId, kind: { notIn: MESSAGE_KINDS } };
  const [items, unread, unreadMessages] = await Promise.all([
    prisma.notification.findMany({ where: notMessage, orderBy: { createdAt: "desc" }, take: PAGE_SIZE }),
    prisma.notification.count({ where: { ...notMessage, readAt: null } }),
    prisma.notification.count({ where: { userId, readAt: null, kind: { in: [...INBOX_MESSAGE_KINDS] } } }),
  ]);
  return { items, unread, unreadMessages };
}

/** Помечает прочитанными уведомления, которые человек увидел на странице. */
export async function markShownRead(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.notification.updateMany({
    where: { userId, id: { in: ids }, readAt: null, kind: { notIn: MESSAGE_KINDS } },
    data: { readAt: new Date() },
  });
}

/** «Отметить все прочитанными»: все уведомления, кроме переписки. */
export async function markAllOtherRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, kind: { notIn: MESSAGE_KINDS } },
    data: { readAt: new Date() },
  });
  await audit({
    actorId: userId,
    actorRole: "user",
    action: "notifications.read_all",
    targetType: "notification",
  });
}
