/**
 * Акции продавца: скидка в процентах на выбранные товары.
 *
 * Скидка честная: зачёркнутая цена равна реальной цене товара до акции
 * (её сохраняет applyPriceChange в oldPriceKopecks), а не придуманной.
 * Когда акция заканчивается (вручную или по сроку), возвращается прежняя цена.
 * Покупателей, которые добавили товар в избранное или ждали снижения цены,
 * уведомляем внутри сайта.
 */
import { prisma } from "../prisma";
import {
  UserFacingError,
  promoPrice,
  promoState,
  raisedRecently,
  promoEndsAt,
  promoDateText,
  duePromotions,
  PROMO_FAIR_PRICE_DAYS,
  PRICE_HISTORY_LOOKBACK_DAYS,
  PROMO_MAX_DAYS,
} from "./engagement-rules";
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

export async function startPromotion(input: { sellerId: string; actorId: string; productIds: unknown; percent: unknown; days?: unknown }) {
  const percent = Number(input.percent);
  const endsAt = promoEndsAt(input.days);
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
    await markPromotion(item.id, item.fromKopecks, item.toKopecks, percent, endsAt);
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
        body: `Теперь ${rubText(s.toKopecks)} вместо ${rubText(s.fromKopecks)}${endsAt ? `, до ${promoDateText(endsAt)}` : ""}.`,
        url: `/product/${s.id}`,
      });
    }
    await notifyMany(inputs);
    notified = new Set(inputs.map((i) => i.userId)).size;
  }
  return { started, skipped, notified, endsAt: endsAt ? endsAt.toISOString() : null };
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

/**
 * Помечает запись журнала цен, созданную запуском акции: процент и дата
 * окончания. По этой пометке акция сама закончится в срок, а в истории цен
 * видно, что снижение было акцией.
 */
async function markPromotion(productId: string, fromKopecks: number, toKopecks: number, percent: number, endsAt: Date | null) {
  const row = await prisma.listingHistory.findFirst({
    where: { productId, action: "PRICE_CHANGED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!row) return;
  await prisma.listingHistory.update({
    where: { id: row.id },
    data: {
      change: JSON.stringify({ priceFrom: fromKopecks, priceTo: toKopecks, promoPercent: percent, promoEndsAt: endsAt ? endsAt.toISOString() : null }),
      note: endsAt ? `Скидка ${percent}% до ${promoDateText(endsAt)}` : `Скидка ${percent}%`,
    },
  });
}

/** Даты окончания идущих акций по товарам (для кабинета). */
export async function promotionEndDates(productIds: string[]): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (productIds.length === 0) return result;
  const since = new Date(Date.now() - (PROMO_MAX_DAYS + 10) * 86_400_000);
  const rows = await prisma.listingHistory.findMany({
    where: { productId: { in: productIds }, action: "PRICE_CHANGED", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { productId: true, change: true },
  });
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.productId)) continue;
    seen.add(row.productId);
    try {
      const d = JSON.parse(row.change ?? "{}") as { promoEndsAt?: unknown };
      if (typeof d.promoEndsAt === "string") result.set(row.productId, new Date(d.promoEndsAt));
    } catch {
      // повреждённая запись: срок неизвестен
    }
  }
  return result;
}

/**
 * Заканчивает акции, у которых вышел срок, и возвращает обычную цену.
 * Запускается фоновой задачей и при открытии раздела «Акции». Если продавец
 * успел сам изменить цену, ничего не трогаем.
 */
export async function expirePromotions(opts: { sellerId?: string; now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (PROMO_MAX_DAYS + 10) * 86_400_000);
  const rows = await prisma.listingHistory.findMany({
    where: {
      action: "PRICE_CHANGED",
      createdAt: { gte: since },
      change: { contains: "promoPercent" },
      ...(opts.sellerId ? { sellerId: opts.sellerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { productId: true, sellerId: true, actorId: true, change: true, createdAt: true },
  });
  let ended = 0;
  const owned = rows.flatMap((r) => (r.sellerId ? [{ ...r, sellerId: r.sellerId }] : []));
  for (const due of duePromotions(owned, now).slice(0, opts.limit ?? 50)) {
    const sellerId = due.sellerId;
    const product = await prisma.product.findFirst({
      where: { id: due.productId, sellerId },
      select: { priceKopecks: true, oldPriceKopecks: true },
    });
    if (!product || !promoState(product).onPromo || product.priceKopecks !== due.priceTo) continue;
    try {
      await endPromotion({ sellerId, actorId: due.actorId ?? "system", productIds: [due.productId] });
      ended += 1;
    } catch {
      // одна ошибка не должна останавливать остальные
    }
  }
  return ended;
}
