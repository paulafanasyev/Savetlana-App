/**
 * Данные для счётчиков в меню кабинета продавца. Только подсчёт, без
 * содержимого заказов и сообщений. Если база не ответила, меню показывается
 * без счётчиков, а не ломает весь кабинет.
 */
import { prisma } from "../prisma";
import { DISPUTE_ACTION_STATUSES, ORDER_ACTION_STATUSES } from "../badge-text";
import { endingSoon } from "../seller-todo";
import { promoState } from "./engagement-rules";
import { promotionEndDates } from "./seller-promotions";

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

/** Сколько штук считается «скоро закончится» (так же, как в отчёте продавца). */
export const LOW_STOCK_MAX = 3;

export interface StockCounts {
  /** Опубликованные товары с остатком 0. */
  out: number;
  /** Опубликованные товары, которых осталось от 1 до LOW_STOCK_MAX штук. */
  low: number;
}

/** Считает все такие товары магазина: список на главной показывает не больше 10. */
export async function sellerStockCounts(sellerId: string): Promise<StockCounts> {
  try {
    const [out, low] = await Promise.all([
      prisma.product.count({ where: { sellerId, status: "ACTIVE", inventory: { is: { quantity: { lte: 0 } } } } }),
      prisma.product.count({ where: { sellerId, status: "ACTIVE", inventory: { is: { quantity: { gte: 1, lte: LOW_STOCK_MAX } } } } }),
    ]);
    return { out, low };
  } catch {
    return { out: 0, low: 0 };
  }
}

/** Сколько опубликованных товаров магазина со скидкой, которая закончится в ближайшие сутки. */
export async function sellerEndingPromos(sellerId: string, now: Date = new Date()): Promise<number> {
  try {
    const rows = await prisma.product.findMany({
      where: { sellerId, status: "ACTIVE", oldPriceKopecks: { not: null } },
      select: { id: true, priceKopecks: true, oldPriceKopecks: true },
      take: 500,
    });
    const ids = rows.filter((p) => promoState(p).onPromo).map((p) => p.id);
    const ends = await promotionEndDates(ids);
    return endingSoon([...ends.values()], now);
  } catch {
    return 0;
  }
}
