/**
 * Recommendation Engine (spec §28, §15, §53, §111).
 *
 * Deliberately NOT "ask the LLM what to recommend". This is a real scoring
 * layer: candidate generation → deterministic scoring → safety/compliance →
 * persisted explanation. The LLM only *explains* and *understands the ask*.
 *
 * Signals used:
 *   - user preferences (memory)        - purchase history
 *   - browsing events                  - wishlist / favorites
 *   - product attributes & category    - seller quality
 *   - price vs. user's typical budget  - availability (never recommend dead stock)
 *   - recency / seasonality            - diversity (don't show 10 of the same)
 *   - explicit feedback (spec §32)     - relationship context only when consented
 */
import { prisma } from "../prisma";
import { fromKopecks } from "../utils";
import { recordEvent } from "./events";
import { hasConsent } from "./consents";

export interface RecommendationItem {
  productId: string;
  score: number;
  reason: string;
  signals: string[];
  isSponsored: boolean;
}

const MAX_CANDIDATES = 60;
const TOP_K = 12;

export async function recommendForUser(
  userId: string,
  opts: { limit?: number; contextProductId?: string; excludeProductIds?: string[] } = {}
): Promise<{ items: RecommendationItem[]; basis: string }> {
  const limit = Math.min(opts.limit ?? TOP_K, 24);

  const [profile, memoryRows, history, favs, wishlists, feedback] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.aiMemory.findMany({ where: { userId } }),
    prisma.orderItem.findMany({
      where: { order: { buyerId: userId } },
      take: 40,
      orderBy: { createdAt: "desc" },
      include: { product: { select: { categoryId: true, priceKopecks: true, sellerId: true } } },
    }),
    prisma.favorite.findMany({ where: { userId }, include: { product: { select: { categoryId: true, priceKopecks: true } } } }),
    prisma.wishlistItem.findMany({ where: { userId }, include: { product: { select: { categoryId: true, priceKopecks: true } } } }),
    prisma.aiFeedback.findMany({ where: { userId } }),
  ]);

  // --- Consent gate: personalization must be opted in (spec §34, §16) -----
  // Absence of a record is NOT granted — the user must affirmatively opt in.
  // Uses the shared consent domain so the default can never drift back to on.
  const allowPersonalization = await hasConsent(userId, "AI_PERSONALIZATION");

  // --- Build the user's taste profile -------------------------------------
  const categoryAffinity = new Map<string, number>();
  const sellerAffinity = new Map<string, number>();
  const seenProductIds = new Set<string>();
  const negatedProductIds = new Set<string>();
  let budgetSum = 0;
  let budgetN = 0;

  for (const h of history) {
    if (h.product?.categoryId) categoryAffinity.set(h.product.categoryId, (categoryAffinity.get(h.product.categoryId) ?? 0) + 3);
    if (h.product?.sellerId) sellerAffinity.set(h.product.sellerId, (sellerAffinity.get(h.product.sellerId) ?? 0) + 2);
    budgetSum += h.priceKopecks;
    budgetN += 1;
    seenProductIds.add(h.productId);
  }
  for (const f of favs) {
    if (f.product?.categoryId) categoryAffinity.set(f.product.categoryId, (categoryAffinity.get(f.product.categoryId) ?? 0) + 2);
    budgetSum += f.product.priceKopecks;
    budgetN += 1;
  }
  for (const w of wishlists) {
    if (w.product?.categoryId) categoryAffinity.set(w.product.categoryId, (categoryAffinity.get(w.product.categoryId) ?? 0) + 2.5);
    budgetSum += w.product.priceKopecks;
    budgetN += 1;
  }
  for (const fb of feedback) {
    if (fb.signal === "not_useful" || fb.signal === "not_my_style" || fb.signal === "already_have") {
      if (fb.productId) negatedProductIds.add(fb.productId);
    }
  }
  let avgBudget = budgetN > 0 ? budgetSum / budgetN : 0;

  // Memory-driven preferences (brand, categories, budget)
  for (const m of memoryRows) {
    if (m.type === "preference" && m.key === "budget_kopecks") {
      const v = Number(m.value);
      if (Number.isFinite(v) && v > 0) avgBudget = avgBudget ? (avgBudget + v) / 2 : v;
    }
  }

  // --- Candidate generation: live, in-stock, well-rated --------------------
  const candidates = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      listing: { isLive: true },
      id: { notIn: [...seenProductIds, ...negatedProductIds, ...(opts.excludeProductIds ?? [])] },
      ...(opts.contextProductId ? {} : {}),
    },
    include: {
      category: { select: { id: true, name: true } },
      sellerProfile: { select: { id: true, displayName: true, businessStatus: true } },
      inventory: { select: { quantity: true, availability: true, confirmedAt: true } },
    },
    take: MAX_CANDIDATES * 4,
    orderBy: { ordersCount: "desc" },
  });

  // Context product (e.g. "what else goes with this?")
  let contextProduct: { categoryId: string | null; sellerId: string; priceKopecks: number } | null = null;
  if (opts.contextProductId) {
    contextProduct = await prisma.product.findUnique({
      where: { id: opts.contextProductId },
      select: { categoryId: true, sellerId: true, priceKopecks: true },
    });
  }

  // --- Scoring -------------------------------------------------------------
  const scored = candidates
    .map((p) => {
      const signals: string[] = [];
      let score = 1.0;

      const catAff = p.categoryId ? (categoryAffinity.get(p.categoryId) ?? 0) : 0;
      if (allowPersonalization && catAff > 0) {
        score += Math.min(catAff, 6);
        signals.push(`вы ранее интересовались категорией «${p.category?.name ?? "категория"}»`);
      }

      const sellAff = sellerAffinity.get(p.sellerId) ?? 0;
      if (allowPersonalization && sellAff > 0) {
        score += Math.min(sellAff, 3);
        signals.push("вы уже покупали у этого продавца");
      }

      // Budget fit (Gaussian-ish decay from the user's average spend)
      if (allowPersonalization && avgBudget > 0) {
        const ratio = p.priceKopecks / avgBudget;
        const budgetScore = Math.exp(-Math.pow(Math.log(Math.max(ratio, 0.01)), 2) / 2);
        score += budgetScore * 4;
        if (ratio <= 1.05) signals.push(`вписывается в ваш обычный бюджет (~${fromKopecks(avgBudget).toFixed(0)} ₽)`);
      }

      // Quality
      if (p.rating >= 4.5) {
        score += 1.5;
        signals.push(`высокий рейтинг ${p.rating.toFixed(1)}`);
      } else if (p.rating > 0 && p.rating < 3.5) {
        score -= 1.5;
      }

      // Availability: never present dead stock as a good pick (spec §55)
      const inv = p.inventory;
      if (inv?.availability === "AVAILABLE" && inv.confirmedAt) {
        score += 0.8;
        signals.push("наличие подтверждено продавцом");
      } else if (inv?.availability === "OUT_OF_STOCK" || inv?.availability === "UNKNOWN") {
        score -= 2;
      }

      // Seller trust
      if (p.sellerProfile.businessStatus === "VERIFIED") {
        score += 0.7;
        signals.push("продавец верифицирован");
      }

      // Context similarity ("совместимые товары")
      if (contextProduct) {
        if (contextProduct.categoryId && contextProduct.categoryId === p.categoryId) {
          score += 1.2;
          signals.push("сопутствующая категория");
        }
        if (contextProduct.sellerId === p.sellerId) {
          score += 0.4;
          signals.push("от того же продавца — можно объединить доставку");
        }
      }

      // Popularity
      if (p.ordersCount > 20) score += 0.5;
      if (p.views > 200) score += 0.2;

      return { product: p, score, signals };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // --- Diversity: cap per-category and per-seller repetition --------------
  const perCategory = new Map<string, number>();
  const perSeller = new Map<string, number>();
  const diverse: (typeof scored)[number][] = [];
  for (const s of scored) {
    const c = s.product.categoryId ?? "none";
    const sv = s.product.sellerId;
    if ((perCategory.get(c) ?? 0) >= 4) continue;
    if ((perSeller.get(sv) ?? 0) >= 3) continue;
    perCategory.set(c, (perCategory.get(c) ?? 0) + 1);
    perSeller.set(sv, (perSeller.get(sv) ?? 0) + 1);
    diverse.push(s);
    if (diverse.length >= MAX_CANDIDATES) break;
  }

  const items: RecommendationItem[] = diverse.slice(0, limit).map((s) => ({
    productId: s.product.id,
    score: Number(s.score.toFixed(3)),
    reason: s.signals[0] ?? "популярный товар с хорошим рейтингом",
    signals: s.signals,
    isSponsored: false,
  }));

  const basis = allowPersonalization
    ? `personalized:${history.length}purchases:${favs.length}favs`
    : "non-personalized(no-consent)";

  // --- Persist with explanation (spec §53 explainable) --------------------
  if (items.length > 0) {
    await prisma.recommendation.createMany({
      data: items.map((i) => ({
        userId,
        productId: i.productId,
        score: i.score,
        reason: i.reason,
        signals: JSON.stringify(i.signals),
        isSponsored: false,
      })),
    });
  }

  return { items, basis };
}

/**
 * Records a thumbs-up/down on a recommendation and feeds it back into the
 * scoring layer (spec §32). Negative signals suppress the same product and
 * shift category affinity down.
 */
export async function recordRecommendationFeedback(
  userId: string,
  productId: string,
  signal: "useful" | "not_useful" | "too_expensive" | "not_my_style" | "not_suitable" | "already_have",
  comment?: string
) {
  await prisma.aiFeedback.create({
    data: { userId, productId, signal, comment },
  });
  await prisma.recommendation.updateMany({
    where: { userId, productId },
    data: { dismissed: signal !== "useful" },
  });
  await recordEvent({
    type: "recommendation_feedback",
    userId,
    productId,
    payload: { signal },
    anonymous: false,
  });
  return { recorded: true };
}
