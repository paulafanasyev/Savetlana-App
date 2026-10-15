/**
 * Что показать покупателю в блоке «Ваш отзыв» на странице товара.
 *
 * Отзыв, который антифрод отправил модератору, скрыт от всех. Без надписи
 * автор думает, что отзыв пропал, и пишет его заново: получается дубль, а
 * антифрод считает это накруткой. Поэтому автору честно пишем «на проверке».
 */
import { prisma } from "../prisma";

const DELIVERED_STATES = ["DELIVERED", "COMPLETED"];

export type ReviewBox =
  | { kind: "guest" }
  | { kind: "not_bought" }
  | { kind: "can_review"; orderId: string }
  | { kind: "moderation" }
  | { kind: "published" };

export interface MyReview {
  orderId: string | null;
  isHidden: boolean;
}

/** Чистое правило, без базы. */
export function reviewBox(input: { loggedIn: boolean; deliveredOrderIds: string[]; myReviews: MyReview[] }): ReviewBox {
  if (!input.loggedIn) return { kind: "guest" };
  const reviewed = new Set(input.myReviews.map((r) => r.orderId).filter((id): id is string => Boolean(id)));
  const open = input.deliveredOrderIds.find((id) => !reviewed.has(id));
  if (open) return { kind: "can_review", orderId: open };
  if (input.myReviews.some((r) => r.isHidden)) return { kind: "moderation" };
  if (input.myReviews.length > 0) return { kind: "published" };
  return { kind: "not_bought" };
}

export async function loadReviewBox(userId: string | null, productId: string): Promise<ReviewBox> {
  if (!userId) return reviewBox({ loggedIn: false, deliveredOrderIds: [], myReviews: [] });
  const [orders, myReviews] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId: userId, status: { in: DELIVERED_STATES }, items: { some: { productId } } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true },
    }),
    prisma.review.findMany({ where: { authorId: userId, productId }, select: { orderId: true, isHidden: true } }),
  ]);
  return reviewBox({ loggedIn: true, deliveredOrderIds: orders.map((o) => o.id), myReviews });
}
