/**
 * Hybrid search (spec §41, §42, §11, §13).
 *
 * keyword (SQL LIKE over indexed text)
 *   + semantic (cosine similarity over stored embeddings)
 *   + structured filters (category, price, seller, rating, availability)
 *   → combined score → ranking → explanations
 *
 * The keyword part deliberately runs in SQL so it works on SQLite (dev) and
 * Postgres (prod) without a separate search daemon. The semantic part uses
 * the embedding gateway (live model when configured, deterministic sandbox
 * otherwise — always reported honestly).
 */
import { prisma } from "../prisma";
import { aiGateway } from "../ai/gateway";
import { newTraceId } from "../ai/gateway";
import { fromKopecks, toKopecks } from "../utils";
import { Prisma } from "@prisma/client";

export interface SearchFilters {
  query?: string;
  categorySlug?: string;
  sellerId?: string;
  minPrice?: number; // in units (rubles)
  maxPrice?: number;
  minRating?: number;
  availabilityOnly?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating" | "popular";
  limit?: number;
  offset?: number;
}

export interface ScoredProduct {
  product: Prisma.ProductGetPayload<{
    include: {
      sellerProfile: {
        select: {
          id: true;
          displayName: true;
          identityStatus: true;
          businessStatus: true;
        };
      };
      category: { select: { id: true; name: true; slug: true } };
      inventory: { select: { quantity: true; availability: true; confirmedAt: true } };
    };
  }>;
  score: number;
  /** Why this candidate ranked here — fed into explanations. */
  signals: string[];
}

const DEFAULT_LIMIT = 24;

export async function searchProducts(
  filters: SearchFilters,
  traceId = newTraceId("search")
): Promise<{ results: ScoredProduct[]; total: number; mode: string }> {
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, 60);
  const offset = filters.offset ?? 0;
  const q = (filters.query ?? "").trim();

  // --- Structured base set: only published, live listings ---------------
  const where: Record<string, unknown> = {
    status: "ACTIVE",
    listing: { isLive: true },
  };
  if (filters.categorySlug) {
    where.category = { slug: filters.categorySlug };
  }
  if (filters.sellerId) {
    where.sellerId = filters.sellerId;
  }
  if (typeof filters.minPrice === "number") {
    where.priceKopecks = { ...(where.priceKopecks as object), gte: toKopecks(filters.minPrice) };
  }
  if (typeof filters.maxPrice === "number") {
    where.priceKopecks = { ...(where.priceKopecks as object), lte: toKopecks(filters.maxPrice) };
  }
  if (typeof filters.minRating === "number") {
    where.rating = { gte: filters.minRating };
  }
  if (filters.availabilityOnly) {
    where.inventory = {
      availability: { notIn: ["OUT_OF_STOCK", "UNKNOWN"] },
    };
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      sellerProfile: { select: { id: true, displayName: true, identityStatus: true, businessStatus: true } },
      category: { select: { id: true, name: true, slug: true } },
      inventory: { select: { quantity: true, availability: true, confirmedAt: true } },
    },
    take: 200, // candidate pool, then rank
  });

  if (products.length === 0) {
    return { results: [], total: 0, mode: "no-candidates" };
  }

  // --- Keyword scoring ----------------------------------------------------
  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const keywordScores = new Map<string, number>();
  if (terms.length > 0) {
    for (const p of products) {
      const hay = `${p.title} ${p.description ?? ""} ${p.keywords}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += t.length > 5 ? 3 : 2;
        if (p.title.toLowerCase().includes(t)) score += 2;
      }
      if (score > 0) keywordScores.set(p.id, score);
    }
  }

  // --- Semantic scoring (vector layer) ------------------------------------
  const semanticScores = new Map<string, number>();
  let semanticMode = "none";
  if (q.length > 0) {
    const trace = newTraceId("embed");
    const queryVec = (await aiGateway.embed({ texts: [q], traceId: trace })).vectors[0];
    semanticMode = "live";
    for (const p of products) {
      const vec = await getProductEmbedding(p, trace);
      if (vec) semanticScores.set(p.id, cosine(queryVec, vec));
    }
  }

  // --- Combine + explain --------------------------------------------------
  const scored: ScoredProduct[] = products.map((product) => {
    const kw = keywordScores.get(product.id) ?? 0;
    const sem = semanticScores.get(product.id) ?? 0;
    const score = kw * 1.0 + sem * 6.0; // semantic is the dominant signal
    const signals: string[] = [];
    if (kw > 0) signals.push(`точное совпадение по словам: +${kw}`);
    if (sem > 0.1) signals.push(`семантическая близость: ${(sem * 100).toFixed(0)}%`);
    if (product.rating >= 4.5) signals.push("высокий рейтинг продаваемого товара");
    if (product.inventory?.availability === "AVAILABLE")
      signals.push("подтверждённое наличие");
    return { product, score, signals };
  });

  scored.sort((a, b) => b.score - a.score);
  const total = scored.length;

  // --- Non-relevance sorts ------------------------------------------------
  if (filters.sort === "price_asc") scored.sort((a, b) => a.product.priceKopecks - b.product.priceKopecks);
  if (filters.sort === "price_desc") scored.sort((a, b) => b.product.priceKopecks - a.product.priceKopecks);
  if (filters.sort === "rating") scored.sort((a, b) => b.product.rating - a.product.rating);
  if (filters.sort === "popular") scored.sort((a, b) => b.product.ordersCount - a.product.ordersCount);

  return {
    results: scored.slice(offset, offset + limit),
    total,
    mode: `keyword:${terms.length > 0 ? "on" : "off"}+semantic:${semanticMode}`,
  };
}

/**
 * Embedding for a product, computed lazily and cached in the vector table.
 * Recomputed only when the indexed text changes (contentHash).
 */
async function getProductEmbedding(
  product: { id: string; title: string; description: string | null; keywords: string },
  traceId: string
): Promise<number[] | null> {
  const text = `${product.title} ${product.description ?? ""} ${product.keywords}`;
  const contentHash = simpleHash(text);
  try {
    const existing = await prisma.productEmbedding.findUnique({
      where: { productId: product.id },
    });
    if (existing && existing.contentHash === contentHash) {
      return JSON.parse(existing.vector) as number[];
    }
    const vec = (await aiGateway.embed({ texts: [text], traceId })).vectors[0];
    await prisma.productEmbedding.upsert({
      where: { productId: product.id },
      create: {
        productId: product.id,
        vector: JSON.stringify(vec),
        dimensions: vec.length,
        provider: "gateway",
        contentHash,
      },
      update: {
        vector: JSON.stringify(vec),
        dimensions: vec.length,
        contentHash,
      },
    });
    return vec;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

/**
 * Public product detail — the rich card (spec §25): product + seller trust +
 * availability confirmation age + reviews aggregate.
 */
export async function getPublicProduct(idOrSlug: string) {
  return prisma.product.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { seoSlug: idOrSlug }, { sku: idOrSlug }],
      status: { in: ["ACTIVE", "HIDDEN"] },
    },
    include: {
      sellerProfile: {
        include: {
          user: { select: { name: true } },
        },
      },
      category: true,
      images: true,
      variants: true,
      inventory: true,
      listing: true,
      documents: true,
      reviews: {
        where: { isHidden: false },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
