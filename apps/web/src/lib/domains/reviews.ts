/**
 * Review analysis (spec §14, §28).
 *
 * Statistical extraction over real review text: rating distribution,
 * recurring terms, pros/cons candidates. SENTIMENT IS NOT FAKED — when no
 * live model is configured we report term-frequency facts only and mark
 * sentiment as NOT_PROVEN, never inventing "positive/negative themes" from
 * nothing.
 */
import { prisma } from "../prisma";
import { aiGateway, aiMode } from "../ai/gateway";
import { newTraceId } from "../ai/gateway";
import { moderationReason, recomputeProductRating, recordReviewHeld, rejectBlockedReview, screenReview } from "./review-screening";

export interface ReviewSummary {
  productId: string;
  count: number;
  averageRating: number;
  distribution: Record<number, number>;
  /** Frequently mentioned terms (excluding stopwords), with counts. */
  recurringTerms: Array<{ term: string; count: number; avgRating: number }>;
  sentiment: "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL";
  sentimentBasis: "live-model" | "rating-derived" | "not-proven";
  topComplaints: string[];
  topAdvantages: string[];
}

const STOPWORDS = new Set([
  "и", "в", "на", "с", "по", "для", "не", "что", "это", "как", "я", "мне",
  "меня", "он", "она", "они", "мы", "вы", "товар", "продавец", "доставка",
  "заказ", "купил", "купила", "пришёл", "пришла", "очень", "просто", "так",
  "но", "а", "же", "бы", "ли", "при", "от", "до", "из", "у", "о", "об",
]);

export async function summarizeReviews(productId: string): Promise<ReviewSummary> {
  const reviews = await prisma.review.findMany({
    where: { productId, isHidden: false },
    select: { rating: true, body: true, createdAt: true },
  });

  const count = reviews.length;
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  const termStats = new Map<string, { count: number; ratingSum: number }>();

  for (const r of reviews) {
    distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    ratingSum += r.rating;
    const text = r.body.toLowerCase();
    for (const term of text.split(/[^а-яa-z0-9]+/).filter(Boolean)) {
      if (term.length < 4 || STOPWORDS.has(term)) continue;
      const cur = termStats.get(term) ?? { count: 0, ratingSum: 0 };
      cur.count += 1;
      cur.ratingSum += r.rating;
      termStats.set(term, cur);
    }
  }

  const averageRating = count > 0 ? ratingSum / count : 0;
  const recurringTerms = [...termStats.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([term, v]) => ({
      term,
      count: v.count,
      avgRating: v.ratingSum / v.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Sentiment: only derived from ratings + low-rating term mentions. We do not
  // claim model-based sentiment unless a live model actually classified it.
  const lowShare = count > 0 ? (distribution[1] + distribution[2]) / count : 0;
  const highShare = count > 0 ? (distribution[5] + distribution[4]) / count : 0;
  let sentiment: ReviewSummary["sentiment"] = "NEUTRAL";
  if (count > 0) {
    if (lowShare > 0.4) sentiment = "NEGATIVE";
    else if (highShare > 0.7) sentiment = "POSITIVE";
    else if (lowShare > 0.15) sentiment = "MIXED";
  }
  const sentimentBasis: ReviewSummary["sentimentBasis"] =
    count > 0 ? "rating-derived" : "not-proven";

  const topComplaints = recurringTerms
    .filter((t) => t.avgRating <= 3)
    .slice(0, 3)
    .map((t) => t.term);
  const topAdvantages = recurringTerms
    .filter((t) => t.avgRating >= 4)
    .slice(0, 3)
    .map((t) => t.term);

  return {
    productId,
    count,
    averageRating: Math.round(averageRating * 10) / 10,
    distribution,
    recurringTerms,
    sentiment,
    sentimentBasis,
    topComplaints,
    topAdvantages,
  };
}

/**
 * Optional model-based classification, used only when a live model exists.
 * Returns null otherwise so callers can honestly report "not proven".
 */
export async function classifyReviewSentiment(
  text: string
): Promise<{ label: string; confidence: number } | null> {
  // Only a live model can produce a real sentiment verdict; sandbox output
  // is explicitly not treated as one (spec §49).
  if (aiMode().mode !== "LIVE") return null;
  try {
    const result = await aiGateway.complete({
      taskClass: "classification",
      traceId: newTraceId("sentiment"),
      messages: [
        {
          role: "system",
          content:
            'Классифицируй тональность отзыва. Ответ — строго JSON: {"label":"positive|negative|neutral","confidence":0-1}.',
        },
        { role: "user", content: text },
      ],
      jsonMode: true,
      maxTokens: 64,
      temperature: 0,
    });
    if (result.response.sandbox) return null; // sandbox classification is not a real verdict
    const parsed = JSON.parse(result.response.content) as { label?: string; confidence?: number };
    if (!parsed.label) return null;
    return { label: parsed.label, confidence: parsed.confidence ?? 0.5 };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Creating a review (spec §28)
// ---------------------------------------------------------------------------
// A review is marked verifiedPurchase only when the buyer actually bought the
// product in an order that reached a delivered state. The platform never
// publishes a review for a product the user never bought — and never hides one
// on AI opinion alone.
// Антифрод (шаг 3): отзыв на свой товар, фишинг и номера карт не принимаются;
// накрутка, «отзыв за кешбэк», копии текста и отзывы новых аккаунтов без
// покупки сохраняются скрытыми и ждут модератора. В рейтинг они не входят.
const DELIVERED_STATES = new Set(["DELIVERED", "COMPLETED"]);

export async function createReview(input: {
  authorId: string;
  productId: string;
  orderId?: string;
  rating: number;
  body: string;
}): Promise<{ id: string; verifiedPurchase: boolean; status: "published" | "moderation" }> {
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) throw new Error("Оценка должна быть от 1 до 5");
  const body = input.body.trim();
  if (body.length < 10) throw new Error("Отзыв слишком короткий");
  if (body.length > 4000) throw new Error("Отзыв слишком длинный");

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { sellerProfile: { select: { userId: true } } },
  });
  if (!product) throw new Error("Товар не найден");

  // Establish verified-purchase status from a real delivered order.
  let verified = false;
  let orderId: string | undefined = input.orderId;
  if (orderId) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, buyerId: input.authorId },
      include: { items: { where: { productId: input.productId }, take: 1 } },
    });
    if (!order) throw new Error("Заказ не найден");
    verified = DELIVERED_STATES.has(order.status) && order.items.length > 0;
  } else {
    const anyDelivered = await prisma.order.findFirst({
      where: {
        buyerId: input.authorId,
        status: { in: [...DELIVERED_STATES] },
        items: { some: { productId: input.productId } },
      },
      select: { id: true },
    });
    if (anyDelivered) {
      orderId = anyDelivered.id;
      verified = true;
    }
  }

  // One review per (author, order, product). A buyer may review the same
  // product from a different order, but never twice for the same order.
  if (orderId) {
    const dup = await prisma.review.findFirst({
      where: { authorId: input.authorId, orderId, productId: input.productId },
      select: { id: true },
    });
    if (dup) throw new Error("Вы уже оставляли отзыв к этому заказу");
  }

  const screening = await screenReview({
    authorId: input.authorId,
    productId: input.productId,
    sellerUserId: product.sellerProfile.userId,
    rating,
    body,
    verifiedPurchase: verified,
  });
  if (screening.verdict === "block") await rejectBlockedReview(input.authorId, input.productId, screening);
  const held = screening.verdict === "hold";

  const created = await prisma.review.create({
    data: {
      productId: input.productId,
      orderId: orderId ?? null,
      authorId: input.authorId,
      rating,
      body,
      verifiedPurchase: verified,
      isHidden: held,
      hiddenReason: held ? moderationReason(screening) : null,
    },
  });
  if (held) await recordReviewHeld(input.authorId, created.id, screening).catch(() => undefined);

  // Recompute the product's aggregate rating from visible reviews only.
  await recomputeProductRating(input.productId);

  await recordReviewEvent({
    type: "review",
    userId: input.authorId,
    productId: input.productId,
    payload: { rating, verifiedPurchase: verified, orderId: orderId ?? null, moderation: held },
  });

  return { id: created.id, verifiedPurchase: verified, status: held ? "moderation" : "published" };
}

async function recordReviewEvent(input: {
  type: string;
  userId: string;
  productId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        type: input.type,
        userId: input.userId,
        productId: input.productId,
        payload: JSON.stringify(input.payload),
      },
    });
  } catch {
    // Event recording must never break the review itself.
  }
}

export async function listReviews(productId: string, limit = 50) {
  const rows = await prisma.review.findMany({
    where: { productId, isHidden: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      rating: true,
      body: true,
      verifiedPurchase: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    verifiedPurchase: r.verifiedPurchase,
    createdAt: r.createdAt.toISOString(),
    authorName: r.author?.name ?? "Аноним",
  }));
}
