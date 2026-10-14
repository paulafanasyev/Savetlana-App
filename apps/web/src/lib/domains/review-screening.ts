/**
 * Проверка отзыва перед публикацией и очередь модерации отзывов.
 * Тексты отзывов в журнал рисков не копируем: только коды правил и id.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { audit } from "./audit";
import { UserFacingError } from "./engagement-rules";
import { REVIEW_MODERATION_PREFIX, explainReview, scanReview, type ReviewVerdict } from "./review-guard";

const DAY = 24 * 60 * 60 * 1000;

function ownDomains(): string[] {
  try {
    return [new URL(env.publicAppUrl).hostname];
  } catch {
    return [];
  }
}

const ageDays = (created: Date, now: Date) => Math.floor((now.getTime() - created.getTime()) / DAY);

export async function screenReview(input: {
  authorId: string;
  productId: string;
  sellerUserId: string | null;
  rating: number;
  body: string;
  verifiedPurchase: boolean;
}): Promise<ReviewVerdict> {
  const now = new Date();
  const [author, authorOrders, authorReviewsLast24h, onProduct, recent] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.authorId }, select: { createdAt: true } }),
    prisma.order.count({ where: { buyerId: input.authorId, status: { notIn: ["CREATED", "PAYMENT_PENDING", "CANCELLED"] } } }),
    prisma.review.count({ where: { authorId: input.authorId, createdAt: { gte: new Date(now.getTime() - DAY) } } }),
    prisma.review.findMany({
      where: { productId: input.productId, authorId: { not: input.authorId }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } },
      select: { rating: true, body: true, verifiedPurchase: true, createdAt: true, author: { select: { createdAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.review.findMany({
      where: { authorId: { not: input.authorId }, productId: { not: input.productId }, createdAt: { gte: new Date(now.getTime() - DAY) } },
      select: { body: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  return scanReview(
    {
      rating: input.rating,
      body: input.body,
      verifiedPurchase: input.verifiedPurchase,
      authorAgeDays: author ? ageDays(author.createdAt, now) : 0,
      authorOrders,
      authorIsSeller: input.sellerUserId !== null && input.sellerUserId === input.authorId,
      authorReviewsLast24h,
    },
    {
      ownDomains: ownDomains(),
      now,
      recentOnProduct: onProduct.map((r) => ({
        rating: r.rating,
        body: r.body,
        verifiedPurchase: r.verifiedPurchase,
        createdAt: r.createdAt,
        authorAgeDays: ageDays(r.author.createdAt, r.createdAt),
      })),
      recentTexts: recent.map((r) => r.body),
    }
  );
}

/** Отказ в публикации: запись в риски и понятная ошибка для автора. */
export async function rejectBlockedReview(authorId: string, productId: string, verdict: ReviewVerdict): Promise<never> {
  await prisma.riskEvent.create({
    data: {
      actorType: "user",
      actorId: authorId,
      level: "HIGH",
      ruleId: "RV2_review_blocked",
      description: "отзыв с признаками мошенничества не принят",
      signals: JSON.stringify({ productId, codes: verdict.findings.map((f) => f.code) }),
      explanation: explainReview(verdict),
      actionTaken: "review_blocked",
    },
  });
  throw new UserFacingError(`Отзыв не принят. ${explainReview(verdict)}.`, 422);
}

export function moderationReason(verdict: ReviewVerdict): string {
  return REVIEW_MODERATION_PREFIX + verdict.findings.map((f) => f.code).join(",");
}

export async function recordReviewHeld(authorId: string, reviewId: string, verdict: ReviewVerdict): Promise<void> {
  await prisma.riskEvent.create({
    data: {
      actorType: "user",
      actorId: authorId,
      level: "REVIEW",
      ruleId: "RV1_review_held",
      description: "отзыв отправлен на проверку модератору",
      signals: JSON.stringify({ reviewId, codes: verdict.findings.map((f) => f.code) }),
      explanation: explainReview(verdict),
      actionTaken: "sent_to_moderation",
    },
  });
}

/** Пересчёт рейтинга товара только по видимым отзывам. */
export async function recomputeProductRating(productId: string): Promise<void> {
  const agg = await prisma.review.aggregate({
    where: { productId, isHidden: false },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.product.update({
    where: { id: productId },
    data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewsCount: agg._count._all },
  });
}

export interface ReviewModerationItem {
  id: string;
  rating: number;
  body: string;
  verifiedPurchase: boolean;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorName: string | null;
  authorEmail: string;
  codes: string[];
}

export async function listReviewModerationQueue(limit = 100): Promise<ReviewModerationItem[]> {
  const rows = await prisma.review.findMany({
    where: { isHidden: true, hiddenReason: { startsWith: REVIEW_MODERATION_PREFIX } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true, rating: true, body: true, verifiedPurchase: true, createdAt: true, hiddenReason: true, productId: true,
      product: { select: { title: true } },
      author: { select: { name: true, email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    verifiedPurchase: r.verifiedPurchase,
    createdAt: r.createdAt,
    productId: r.productId,
    productTitle: r.product.title,
    authorName: r.author.name,
    authorEmail: r.author.email,
    codes: (r.hiddenReason ?? "").slice(REVIEW_MODERATION_PREFIX.length).split(",").filter(Boolean),
  }));
}

export async function moderateReview(reviewId: string, approve: boolean, adminId: string, note?: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { id: true, isHidden: true, hiddenReason: true, productId: true } });
  if (!review) throw new UserFacingError("Отзыв не найден", 404);
  if (!review.isHidden || !review.hiddenReason?.startsWith(REVIEW_MODERATION_PREFIX)) {
    throw new UserFacingError("Отзыв уже не на проверке", 409);
  }
  await prisma.review.update({
    where: { id: reviewId },
    data: approve
      ? { isHidden: false, hiddenReason: null, flaggedById: null }
      : { hiddenReason: `rejected:${(note ?? "").slice(0, 200)}`, flaggedById: adminId },
  });
  if (approve) await recomputeProductRating(review.productId);
  await audit({
    actorId: adminId,
    actorRole: "admin",
    action: approve ? "review.moderation_approved" : "review.moderation_rejected",
    targetType: "Review",
    targetId: reviewId,
    before: { hiddenReason: review.hiddenReason },
    after: { approved: approve, note: note?.slice(0, 200) ?? null },
  });
  return { id: reviewId, published: approve };
}
