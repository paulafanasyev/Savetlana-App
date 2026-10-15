/**
 * Продление идущей скидки: меняем только дату окончания в записи журнала
 * цен, по которой акция сама закончится. Цены товаров не трогаем, поэтому
 * покупатели ничего не замечают, кроме новой даты.
 */
import { prisma } from "../prisma";
import { UserFacingError, promoDateText, promoMark, promoState } from "./engagement-rules";
import { extendReasonText, extendedEnd } from "./promo-extend-rules";

const MAX_PRODUCTS = 100;

export async function extendPromotion(input: { sellerId: string; productIds: unknown; days: unknown; now?: Date }) {
  const list = Array.isArray(input.productIds) ? input.productIds.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  if (list.length === 0) throw new UserFacingError("Выберите хотя бы один товар", 400);
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(list)].slice(0, MAX_PRODUCTS) }, sellerId: input.sellerId, status: "ACTIVE" },
    select: { id: true, title: true, priceKopecks: true, oldPriceKopecks: true },
  });
  const extended: { id: string; title: string; endsAt: string }[] = [];
  const skipped: { title: string; reason: string }[] = [];
  for (const p of products) {
    if (!promoState(p).onPromo) {
      skipped.push({ title: p.title, reason: "скидка не идёт" });
      continue;
    }
    const row = await prisma.listingHistory.findFirst({
      where: { productId: p.id, action: "PRICE_CHANGED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, change: true, createdAt: true },
    });
    const mark = row ? promoMark(row) : null;
    // Последнее изменение цены должно быть запуском этой скидки, иначе запись чужая.
    if (!row || !mark || mark.priceTo !== p.priceKopecks) {
      skipped.push({ title: p.title, reason: "не нашла запуск скидки в истории цен" });
      continue;
    }
    const result = extendedEnd({ startedAt: row.createdAt, endsAt: mark.endsAt, days: input.days, now: input.now });
    if (!result.ok) {
      skipped.push({ title: p.title, reason: extendReasonText(result.reason) });
      continue;
    }
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.change ?? "{}") as Record<string, unknown>;
    } catch {
      data = {};
    }
    const percent = typeof data.promoPercent === "number" ? data.promoPercent : promoState(p).percent;
    await prisma.listingHistory.update({
      where: { id: row.id },
      data: {
        change: JSON.stringify({ ...data, promoEndsAt: result.endsAt.toISOString() }),
        note: `Скидка ${percent}% до ${promoDateText(result.endsAt)}`,
      },
    });
    extended.push({ id: p.id, title: p.title, endsAt: result.endsAt.toISOString() });
  }
  if (extended.length === 0) {
    throw new UserFacingError(skipped[0]?.reason ?? "Среди выбранных нет товаров со скидкой", 400);
  }
  return { extended, skipped };
}
