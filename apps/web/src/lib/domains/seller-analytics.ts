/**
 * Seller Analytics (spec §7, §27, §50, §51, §159).
 *
 * Answers questions like "why did sales drop?" from real data: views, search
 * events, conversion, price position, reviews, inventory and delivery.
 * Every cause in the report is labelled with the metric that supports it, so
 * the seller can verify the reasoning themselves.
 */
import { prisma } from "../prisma";
import { fromKopecks } from "../utils";
import { pricePosition } from "./pricing";
import { summarizeReviews } from "./reviews";

export interface ProductHealth {
  productId: string;
  title: string;
  status: string;
  photos: number;
  hasDescription: boolean;
  attributesCount: number;
  keywordsCount: number;
  views: number;
  orders: number;
  conversion: number;
  rating: number;
  reviewsCount: number;
  availability: string;
  confirmed: boolean;
  /** Lower is healthier. 0 = nothing to fix. */
  issues: string[];
  healthScore: number;
}

export interface SellerReport {
  totals: {
    products: number;
    active: number;
    orders: number;
    revenueKopecks: number;
    avgConversion: number;
    rating: number;
  };
  health: ProductHealth[];
  salesDropCauses: string[];
  recommendations: {
    priority: "high" | "medium" | "low";
    text: string;
    evidence: string;
  }[];
  lowStock: { productId: string; title: string; quantity: number }[];
  stale: { productId: string; title: string; days: number }[];
}

export async function productHealth(productId: string): Promise<ProductHealth> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      images: true,
      inventory: true,
      reviews: { where: { isHidden: false } },
    },
  });
  if (!product) throw new Error("товар не найден");

  const issues: string[] = [];
  if (product.images.length === 0) issues.push("нет ни одной фотографии");
  else if (product.images.length < 3) issues.push("мало фотографий (рекомендуется от 3)");
  if (!product.description || product.description.length < 100) issues.push("короткое описание");
  const attributes = safeParse(product.attributes);
  if (Object.keys(attributes).length < 3) issues.push("мало характеристик");
  if (safeArray(product.keywords).length === 0) issues.push("не указаны ключевые слова для поиска");
  if (product.reviewsCount === 0 && product.ordersCount > 3) issues.push("нет отзывов при наличии продаж");
  const inv = product.inventory;
  if (inv && !inv.confirmedBySeller) issues.push("наличие не подтверждено продавцом");
  if (product.views > 100 && product.ordersCount === 0) issues.push("много просмотров, но нет заказов");
  if (product.status !== "ACTIVE") issues.push(`статус карточки: ${product.status}`);

  const conversion = product.views > 0 ? product.ordersCount / product.views : 0;
  // Health is a deterministic function of issue count and conversion — no
  // hidden "magic rating" (spec §51).
  const penalty = Math.min(issues.length * 12, 70);
  const conversionBonus = Math.min(conversion * 500, 20);
  const healthScore = Math.max(0, Math.min(100, Math.round(85 - penalty + conversionBonus)));

  return {
    productId,
    title: product.title,
    status: product.status,
    photos: product.images.length,
    hasDescription: Boolean(product.description && product.description.length >= 100),
    attributesCount: Object.keys(attributes).length,
    keywordsCount: safeArray(product.keywords).length,
    views: product.views,
    orders: product.ordersCount,
    conversion,
    rating: product.rating,
    reviewsCount: product.reviewsCount,
    availability: inv?.availability ?? "UNKNOWN",
    confirmed: inv?.confirmedBySeller ?? false,
    issues,
    healthScore,
  };
}

function safeParse(raw: string | null | undefined): Record<string, unknown> {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function safeArray(raw: string | null | undefined): unknown[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function sellerReport(sellerId: string): Promise<SellerReport> {
  const products = await prisma.product.findMany({
    where: { sellerId },
    include: { inventory: true, listing: true },
  });
  const orders = await prisma.order.findMany({
    where: { sellerId },
    select: { id: true, status: true, totalKopecks: true, createdAt: true },
  });
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true, trustSignals: true },
  });

  const health = await Promise.all(products.map((p) => productHealth(p.id)));
  const active = products.filter((p) => p.status === "ACTIVE");
  const completed = orders.filter((o) => ["COMPLETED", "DELIVERED"].includes(o.status));
  const revenue = completed.reduce((sum, o) => sum + (o.totalKopecks ?? 0), 0);
  const views = products.reduce((s, p) => s + p.views, 0);
  const orderCount = orders.length;
  const avgConversion = views > 0 ? orderCount / views : 0;

  // --- Sales-drop diagnosis: compare the last 7 days to the prior 14 -------
  const now = Date.now();
  const recent = orders.filter((o) => now - o.createdAt.getTime() < 7 * 864e5).length;
  const prior = orders.filter((o) => {
    const d = now - o.createdAt.getTime();
    return d >= 7 * 864e5 && d < 21 * 864e5;
  }).length;
  const salesDropCauses: string[] = [];
  if (prior > 0 && recent < prior * 0.6) {
    salesDropCauses.push(
      `Заказов за последние 7 дней: ${recent}, за предыдущие 14: ${prior}. Спад подтверждён данными.`
    );
    const unconfirmed = products.filter((p) => p.inventory && !p.inventory.confirmedBySeller);
    if (unconfirmed.length > 0) {
      salesDropCauses.push(
        `${unconfirmed.length} товаров с неподтверждённым наличием — такие карточки не показываются как гарантированно доступные.`
      );
    }
    const lowHealth = health.filter((h) => h.healthScore < 60);
    if (lowHealth.length > 0) {
      salesDropCauses.push(
        `${lowHealth.length} карточек с низким health score: ${lowHealth.slice(0, 3).map((h) => `«${h.title}»`).join(", ")}.`
      );
    }
    const staleListings = products.filter(
      (p) => p.listing && p.listing.expiresAt && p.listing.expiresAt.getTime() < Date.now() && p.listing.isLive
    );
    if (staleListings.length > 0) {
      salesDropCauses.push(`${staleListings.length} размещений просрочены и требуют продления.`);
    }
    if (salesDropCauses.length === 1) {
      salesDropCauses.push("Очевидных проблем с карточками не найдено — спад может быть сезонным или внешним.");
    }
  }

  const recommendations: SellerReport["recommendations"] = [];
  for (const h of health.filter((x) => x.issues.length > 0).slice(0, 6)) {
    recommendations.push({
      priority: h.healthScore < 50 ? "high" : "medium",
      text: `Карточка «${h.title}»: ${h.issues.join("; ")}.`,
      evidence: `health ${h.healthScore}/100, ${h.views} просмотров, ${h.orders} заказов`,
    });
  }
  const above = await Promise.all(
    active.filter((p) => p.ordersCount === 0 && p.views > 50).slice(0, 3).map((p) => pricePosition(p.id))
  );
  for (const pos of above) {
    if (pos.position === "above_market" && pos.marketMedian) {
      recommendations.push({
        priority: "high",
        text: `Цена выше рынка на ${fromKopecks(pos.ownPriceKopecks - pos.marketMedian)} ₽ при медиане ${fromKopecks(pos.marketMedian)} ₽. Стоит пересмотреть цену.`,
        evidence: `перцентиль цены ${pos.percentile}, ${pos.competitorCount} конкурентов`,
      });
    }
  }
  const reviewed = await Promise.all(
    active.filter((p) => p.reviewsCount >= 3).slice(0, 3).map((p) => summarizeReviews(p.id))
  );
  for (const sum of reviewed) {
    if (sum.topComplaints.length > 0) {
      recommendations.push({
        priority: "medium",
        text: `В отзывах повторяется: ${sum.topComplaints.slice(0, 2).join("; ")}.`,
        evidence: `${sum.count} отзывов, средняя оценка ${sum.averageRating.toFixed(1)}`,
      });
    }
  }

  const lowStock = products
    .filter((p) => p.inventory && p.inventory.quantity <= 3 && p.status === "ACTIVE")
    .map((p) => ({ productId: p.id, title: p.title, quantity: p.inventory!.quantity }))
    .slice(0, 10);

  const stale = products
    .filter((p) => p.status === "ACTIVE" && (!p.listing || !p.listing.isLive))
    .map((p) => ({
      productId: p.id,
      title: p.title,
      days: p.listing?.expiresAt ? Math.floor((Date.now() - p.listing.expiresAt.getTime()) / 864e5) : 0,
    }))
    .slice(0, 10);

  return {
    totals: {
      products: products.length,
      active: active.length,
      orders: orderCount,
      revenueKopecks: revenue,
      avgConversion,
      rating: sellerTrustRating(seller?.trustSignals),
    },
    health,
    salesDropCauses,
    recommendations: recommendations.slice(0, 8),
    lowStock,
    stale,
  };
}

/**
 * AI workflow rules (spec §113, §114): a natural-language seller request is
 * turned into a deterministic trigger/action rule, never into free-form code.
 */
const WORKFLOW_TRIGGERS = new Set([
  "inventory_low",
  "availability_expiring",
  "new_review",
  "competitor_price_drop",
]);
const WORKFLOW_ACTIONS = new Set(["notify_seller", "draft_review_reply", "ask_renew"]);

export interface ParsedRule {
  trigger: string;
  action: string;
  condition: Record<string, unknown>;
}

export function parseWorkflowRule(text: string): ParsedRule | null {
  const lower = text.toLowerCase();
  let trigger: string | null = null;
  let action: string | null = null;

  if (/наличи|остаток|заканчива/.test(lower)) trigger = "inventory_low";
  else if (/размещени|истека|продл/.test(lower)) trigger = "availability_expiring";
  else if (/отзыв/.test(lower)) trigger = "new_review";
  else if(/цен.*(конкурент|ниже)|конкурент.*цен/.test(lower)) trigger = "competitor_price_drop";
  if (!trigger) return null;

  if (/напомин|сообщ|уведом/.test(lower)) action = "notify_seller";
  else if (/отзыв/.test(lower) && trigger === "new_review") action = "draft_review_reply";
  else if (/продл/.test(lower)) action = "ask_renew";
  else action = "notify_seller";
  if (!action || !WORKFLOW_ACTIONS.has(action)) return null;
  if (!WORKFLOW_TRIGGERS.has(trigger)) return null;

  return { trigger, action, condition: { sourceText: text.slice(0, 500) } };
}

export async function saveWorkflowRule(sellerId: string, rule: ParsedRule, createdByAi: boolean) {
  return prisma.workflowRule.create({
    data: {
      sellerId,
      trigger: rule.trigger,
      action: rule.action,
      condition: JSON.stringify(rule.condition),
      isEnabled: true,
      createdByAi,
    },
  });
}

export async function listWorkflowRules(sellerId: string) {
  return prisma.workflowRule.findMany({ where: { sellerId }, orderBy: { createdAt: "desc" } });
}

function sellerTrustRating(trustSignals: string | null | undefined): number {
  try {
    const v = trustSignals ? JSON.parse(trustSignals) : {};
    return typeof v.avgRating === "number" ? v.avgRating : 0;
  } catch {
    return 0;
  }
}
