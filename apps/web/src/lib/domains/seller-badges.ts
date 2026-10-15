/**
 * Данные для счётчиков в меню кабинета продавца. Только подсчёт, без
 * содержимого заказов и сообщений. Если база не ответила, меню показывается
 * без счётчиков, а не ломает весь кабинет.
 */
import { prisma } from "../prisma";
import { DISPUTE_ACTION_STATUSES, ORDER_ACTION_STATUSES } from "../badge-text";

export interface SellerBadges {
  orders: number;
  messages: number;
  disputes: number;
}

export async function sellerBadges(sellerId: string, sellerUserId: string): Promise<SellerBadges> {
  try {
    const [orders, messages, disputes] = await Promise.all([
      prisma.order.count({ where: { sellerId, status: { in: [...ORDER_ACTION_STATUSES] } } }),
      prisma.notification.count({ where: { userId: sellerUserId, kind: "buyer_message", readAt: null } }),
      prisma.dispute.count({ where: { sellerId, status: { in: [...DISPUTE_ACTION_STATUSES] } } }),
    ]);
    return { orders, messages, disputes };
  } catch {
    return { orders: 0, messages: 0, disputes: 0 };
  }
}
