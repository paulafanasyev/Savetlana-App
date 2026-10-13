/**
 * Акции продавца: скидка в процентах на выбранные товары.
 *
 * Скидка честная: зачёркнутая цена равна реальной цене товара до акции
 * (её сохраняет applyPriceChange в oldPriceKopecks), а не придуманной.
 * Когда акция заканчивается, возвращается прежняя цена. Покупателей, которые
 * добавили товар в избранное или ждали снижения цены, уведомляем внутри сайта.
 */
import { prisma } from "../prisma";
import { UserFacingError, promoPrice, promoState, raisedRecently, PROMO_FAIR_PRICE_DAYS, PRICE_HISTORY_LOOKBACK_DAYS } from "./engagement-rules";
import { applyPriceChange } from "./pricing";
import { notifyMany, type NotificationInput } from "./notifications";

const MAX_PRODUCTS = 100;

/** Какие из товаров дорожали за последние две недели (по журналу цен). */
export async function recentlyRaisedIds(productIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const since = new Date(now.getTime() - PRICE_HISTORY_LOOKBACK_DAYS * 86_400_000);
  const changes = await prisma.listingHistory.findMany({
    where: { productId: { in: productIds }, action: "PRICE_CHANGED", createdAt: { gte: since } },
    select: { productId: true, change: true, createdAt: true },
  });
  return raisedRecently(changes, now);
}

function rubText(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

function ids(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  if (list.length === 0) throw new UserFacingError("Выберите хотя бы один товар", 400);
  return [...new Set(list)].slice(0, MAX_PRODUCTS);
}

export async function startPromotion(input: { sellerId: string; actorId: string; productIds: unknown; percent: unknown }) {
  const percent = Number(input.percent);
  const products = await prisma.product.findMany({
    where: { id: { in: ids(input.productIds) }, sellerId: input.sellerId, status: "ACTIVE" },
    select: { id: true, title: true, priceKopecks: true, oldPriceKopecks: true },
  });
  if (products.length === 0) throw new UserFacingError("Среди выбранных нет ваших опубликованных товаров", 404);

  const started: { id: string; title: string; fromKopecks: number; toKopecks: number }[] = [];
  const skipped: string[] = [];
  const raised = await recentlyRaisedIds(products.map((p) => p.id));
  if (raised.size === products.length) {
    throw new UserFacingError(`Цену этих товаров повышали за последние ${PROMO_FAIR_PRICE_DAYS} дней. Скидку от поднятой цены запускать нельзя: зачёркнутая цена должна быть настоящей`, 400);
  }
  // Сначала считаем все цены: если скидка не подходит хоть одному товару, ничего не меняем.
  const plan = products.flatMap((p) => {
    if (promoState(p).onPromo || raised.has(p.id)) {
      skipped.push(p.title);
      return [];
    }
    return [{ id: p.id, title: p.title, fromKopecks: p.priceKopecks, toKopecks: promoPrice(p.priceKopecks, percent) }];
  });
  for (const item of plan) {
    await applyPriceChange({ productId: item.id, sellerId: input.sellerId, newPriceKopecks: item.toKopecks, actorId: input.actorId, actorRole: "seller", confirmed: true });
    started.push(item);
  }

  let notified = 0;
  if (started.length > 0) {
    const productIds = started.map((s) => s.id);
    const seller = await prisma.sellerProfile.findUnique({ where: { id: input.sellerId }, select: { userId: true } });
    const [favorites, wishlist, alerts] = await Promise.all([
      prisma.favorite.findMany({ where: { productId: { in: productIds } }, select: { userId: true, productId: true } }),
      prisma.wishlistItem.findMany({ where: { productId: { in: productIds } }, select: { userId: true, productId: true } }),
      prisma.priceAlert.findMany({ where: { productId: { in: productIds } }, select: { userId: true, productId: true, thresholdKopecks: true } }),
    ]);
    const byId = new Map(started.map((s) => [s.id, s]));
    const pairs = new Set<string>();
    for (const row of [...favorites, ...wishlist]) pairs.add(`${row.userId}|${row.productId}`);
    for (const a of alerts) if ((byId.get(a.productId)?.toKopecks ?? Infinity) <= a.thresholdKopecks) pairs.add(`${a.userId}|${a.productId}`);
    const inputs: NotificationInput[] = [];
    for (const pair of pairs) {
      const [userId, productId] = pair.split("|");
      const s = byId.get(productId);
      if (!s || userId === seller?.userId) continue;
      inputs.push({
        userId,
        kind: "price_drop",
        title: `Скидка ${percent}% на «${s.title}»`,
        body: `Теперь ${rubText(s.toKopecks)} вместо ${rubText(s.fromKopecks)}.`,
        url: `/product/${s.id}`,
      });
    }
    await notifyMany(inputs);
    notified = new Set(inputs.map((i) => i.userId)).size;
  }
  return { started, skipped, notified };
}

export async function endPromotion(input: { sellerId: string; actorId: string; productIds: unknown }) {
  const products = await prisma.product.findMany({
    where: { id: { in: ids(input.productIds) }, sellerId: input.sellerId },
    select: { id: true, title: true, priceKopecks: true, oldPriceKopecks: true },
  });
  const ended: string[] = [];
  for (const p of products) {
    if (!promoState(p).onPromo || !p.oldPriceKopecks) continue;
    await applyPriceChange({ productId: p.id, sellerId: input.sellerId, newPriceKopecks: p.oldPriceKopecks, actorId: input.actorId, actorRole: "seller", confirmed: true });
    await prisma.product.update({ where: { id: p.id }, data: { oldPriceKopecks: null } });
    ended.push(p.title);
  }
  if (ended.length === 0) throw new UserFacingError("Среди выбранных товаров нет товаров со скидкой", 400);
  return { ended };
}
