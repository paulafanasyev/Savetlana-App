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
