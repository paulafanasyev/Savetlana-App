/**
 * Отзывы о работе исполнителя: только заказчик, только по завершённой сделке,
 * один отзыв на заказ. Исполнитель удалить отзыв не может: уведомления
 * можно только прочитать. У записи отзыва постоянный ключ по заказу, поэтому
 * двойное нажатие не создаст второй отзыв.
 */
import { prisma } from "../prisma";
import { UserFacingError } from "./engagement-rules";
import { serviceMeta } from "../service-deal";
import { REVIEWABLE_STATUSES, SERVICE_REVIEW_KIND, cleanServiceReview, parseReviewBody, reviewBody, reviewPrefix, type ServiceReview } from "../service-reviews";

/** Постоянный ключ записи отзыва: один на заказ. */
export const serviceReviewId = (orderId: string) => `svcrev_${orderId}`;

export async function hasServiceReview(performerUserId: string, orderNumber: string): Promise<boolean> {
  const n = await prisma.notification.count({
    where: { userId: performerUserId, kind: SERVICE_REVIEW_KIND, body: { startsWith: reviewPrefix(orderNumber) } },
  });
  return n > 0;
}

export async function leaveServiceReview(buyerId: string, orderId: string, input: { rating?: unknown; text?: unknown }): Promise<{ rating: number }> {
  const review = cleanServiceReview(input);
  if (!review.ok) throw new UserFacingError(review.error, 400);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, status: true, buyerId: true, deliveryAddress: true },
  });
  const meta = order ? serviceMeta(order.deliveryAddress) : null;
  if (!order || !meta) throw new UserFacingError("Заказ не найден", 404);
  if (order.buyerId !== buyerId) throw new UserFacingError("Отзыв может оставить только заказчик", 403);
  if (!REVIEWABLE_STATUSES.includes(order.status)) throw new UserFacingError("Отзыв можно оставить после того, как работа принята", 409);
  const already = new UserFacingError("Вы уже оставили отзыв по этому заказу", 409);
  if (await hasServiceReview(meta.performerId, order.number)) throw already;
  try {
    await prisma.notification.create({
      data: {
        id: serviceReviewId(order.id),
        userId: meta.performerId,
        kind: SERVICE_REVIEW_KIND,
        title: `Новый отзыв о вашей работе: ${review.rating} из 5`,
        body: reviewBody(order.number, review.rating, review.text),
        url: `/performers/${meta.performerId}`,
      },
    });
  } catch (e) {
    // Второе одновременное нажатие упирается в тот же ключ.
    const exists = await prisma.notification.findUnique({ where: { id: serviceReviewId(order.id) }, select: { id: true } });
    if (exists) throw already;
    throw e;
  }
  return { rating: review.rating };
}

export interface ServiceReviewView extends ServiceReview {
  createdAt: Date;
}

/** Отзывы об исполнителе, новые сверху, по одному на заказ. */
export async function listServiceReviews(performerUserId: string, take = 500): Promise<ServiceReviewView[]> {
  const rows = await prisma.notification.findMany({
    where: { userId: performerUserId, kind: SERVICE_REVIEW_KIND },
    orderBy: { createdAt: "desc" },
    take,
    select: { body: true, createdAt: true },
  });
  const seen = new Set<string>();
  const out: ServiceReviewView[] = [];
  for (const r of rows) {
    const parsed = parseReviewBody(r.body);
    if (!parsed || seen.has(parsed.orderNumber)) continue;
    seen.add(parsed.orderNumber);
    out.push({ ...parsed, createdAt: r.createdAt });
  }
  return out;
}
