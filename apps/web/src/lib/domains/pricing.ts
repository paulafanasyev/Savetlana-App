/**
 * Price Intelligence (spec §19 pricing agent, §54 price history).
 *
 * Analysis is computed from real catalog and competitor data. The recommendation
 * is advisory: an actual price change is a HIGH_RISK_WRITE that requires the
 * seller's confirmation (spec §19, §45).
 */
import { prisma } from "../prisma";
import { fromKopecks, toKopecks } from "../utils";
import { audit } from "./audit";

export interface PricePosition {
  ownPriceKopecks: number;
  marketMin: number | null;
  marketMax: number | null;
  marketMedian: number | null;
  competitorCount: number;
  position: "below_market" | "at_market" | "above_market" | "no_data";
  percentile: number | null;
}

export interface PriceAdvice {
  productId: string;
  title: string;
  position: PricePosition;
  /** Direction the data points to, with the reasoning the seller will see. */
  direction: "lower" | "raise" | "hold";
  reasoning: string[];
  /** Suggested price is a hint, never an auto-applied value. */
  suggestedPriceKopecks: number | null;
  confidence: number;
  requiresConfirmation: boolean;
}

async function competitorPrices(productId: string) {
  return prisma.competitorListing.findMany({
    where: { productId },
    orderBy: { priceKopecks: "asc" },
  });
}

export async function pricePosition(productId: string): Promise<PricePosition> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { priceKopecks: true },
  });
  if (!product) throw new Error("товар не найден");

  const comps = await competitorPrices(productId);
  const prices = comps.map((c) => c.priceKopecks);
  // Include own-catalog alternatives: same category, active, other sellers.
  const ownCategory = await prisma.product.findMany({
    where: { status: "ACTIVE", id: { not: productId } },
    select: { priceKopecks: true, categoryId: true, sellerId: true },
    take: 200,
  });
  const productCategory = await prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true },
  });
  const sameCategory = ownCategory.filter((p) => p.categoryId === productCategory?.categoryId);
  for (const p of sameCategory) prices.push(p.priceKopecks);

  if (prices.length === 0) {
    return {
      ownPriceKopecks: product.priceKopecks,
      marketMin: null,
      marketMax: null,
      marketMedian: null,
      competitorCount: 0,
      position: "no_data",
      percentile: null,
    };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const below = sorted.filter((p) => p < product.priceKopecks).length;
  const percentile = Math.round((below / sorted.length) * 100);

  let position: PricePosition["position"] = "at_market";
  if (percentile <= 20) position = "below_market";
  else if (percentile >= 70) position = "above_market";

  return {
    ownPriceKopecks: product.priceKopecks,
    marketMin: sorted[0],
    marketMax: sorted[sorted.length - 1],
    marketMedian: median,
    competitorCount: comps.length,
    position,
    percentile,
  };
}

export async function adviseOnPrice(productId: string): Promise<PriceAdvice> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, priceKopecks: true, views: true, ordersCount: true, oldPriceKopecks: true },
  });
  if (!product) throw new Error("товар не найден");

  const pos = await pricePosition(productId);
  const reasoning: string[] = [];
  let direction: PriceAdvice["direction"] = "hold";
  let suggestedPriceKopecks: number | null = null;
  let confidence = 0.4;

  const conversion = product.views > 0 ? product.ordersCount / product.views : 0;

  if (pos.position === "above_market" && pos.marketMedian) {
    direction = "lower";
    reasoning.push(
      `Цена ${fromKopecks(product.priceKopecks)} ₽ выше большинства сопоставимых предложений ` +
        `(медиана рынка ${fromKopecks(pos.marketMedian)} ₽, ваш перцентиль ${pos.percentile}).`
    );
    if (conversion < 0.01 && product.views > 50) {
      reasoning.push(
        `Конверсия ${(conversion * 100).toFixed(1)}% при ${product.views} просмотрах — ниже ожидаемой для этого уровня цены.`
      );
      suggestedPriceKopecks = Math.round(pos.marketMedian * 0.97);
      confidence = 0.72;
    } else {
      suggestedPriceKopecks = pos.marketMedian;
      confidence = 0.6;
    }
  } else if (pos.position === "below_market" && pos.marketMedian) {
    direction = "raise";
    reasoning.push(
      `Цена ${fromKopecks(product.priceKopecks)} ₽ заметно ниже рынка (медиана ${fromKopecks(pos.marketMedian)} ₽). ` +
        `Возможно, вы недополучаете выручку при сопоставимом качестве.`
    );
    suggestedPriceKopecks = Math.round(pos.marketMedian * 0.95);
    confidence = 0.55;
  } else {
    reasoning.push("Цена находится в рыночном коридоре среди сопоставимых предложений.");
    if (conversion < 0.005 && product.views > 50) {
      reasoning.push(
        "Конверсия низкая, но цена не является причиной — стоит проверить карточку, фотографии и отзывы."
      );
    }
    confidence = 0.5;
  }

  return {
    productId,
    title: product.title,
    position: pos,
    direction,
    reasoning,
    suggestedPriceKopecks,
    confidence,
    requiresConfirmation: true,
  };
}

export interface PriceHistoryPoint {
  priceKopecks: number;
  at: Date;
  note: string | null;
}

/**
 * Price history is reconstructed from the immutable listing-history audit
 * trail (spec §11, §54). No invented discount narrative.
 */
export async function priceHistory(productId: string): Promise<PriceHistoryPoint[]> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { priceKopecks: true, createdAt: true },
  });
  if (!product) return [];

  const changes = await prisma.listingHistory.findMany({
    where: { productId, action: "PRICE_CHANGED" },
    orderBy: { createdAt: "asc" },
  });

  const points: PriceHistoryPoint[] = [
    { priceKopecks: 0, at: product.createdAt, note: "создание карточки" },
  ];
  for (const c of changes) {
    try {
      const change = JSON.parse(c.change ?? "{}");
      if (typeof change.priceTo === "number") {
        points.push({ priceKopecks: change.priceTo, at: c.createdAt, note: c.note });
      }
    } catch {
      // corrupted change payload — skip rather than guess
    }
  }
  points.push({ priceKopecks: product.priceKopecks, at: new Date(), note: "текущая цена" });
  return points;
}

export interface ApplyPriceInput {
  productId: string;
  sellerId: string;
  newPriceKopecks: number;
  actorId: string;
  actorRole: string;
  /** Must be true — the caller proves the seller confirmed. */
  confirmed: boolean;
}

export async function applyPriceChange(input: ApplyPriceInput) {
  if (!input.confirmed) throw new Error("изменение цены требует подтверждения продавца");
  if (!Number.isInteger(input.newPriceKopecks) || input.newPriceKopecks <= 0) {
    throw new Error("некорректная цена");
  }
  const product = await prisma.product.findFirst({
    where: { id: input.productId, sellerId: input.sellerId },
  });
  if (!product) throw new Error("товар не найден");

  const oldPrice = product.priceKopecks;
  if (oldPrice === input.newPriceKopecks) return product;

  const updated = await prisma.product.update({
    where: { id: input.productId },
    data: { oldPriceKopecks: oldPrice, priceKopecks: input.newPriceKopecks },
  });
  await prisma.listingHistory.create({
    data: {
      productId: input.productId,
      sellerId: input.sellerId,
      action: "PRICE_CHANGED",
      change: JSON.stringify({ priceFrom: oldPrice, priceTo: input.newPriceKopecks }),
      actorId: input.actorId,
    },
  });
  await audit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "product.price_changed",
    targetType: "product",
    targetId: input.productId,
    before: { priceKopecks: oldPrice },
    after: { priceKopecks: input.newPriceKopecks },
  });
  return updated;
}

export function kopecks(rub: number): number {
  return toKopecks(rub);
}
