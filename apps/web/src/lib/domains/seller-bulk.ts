/**
 * Массовое изменение цен и остатков в кабинете продавца. Каждое изменение
 * пишется в журнал товара, цена в том же формате, что и у остальных изменений
 * цены, поэтому правило честных скидок видит и массовые повышения.
 */
import { prisma } from "../prisma";
import { computeAvailability } from "./inventory";
import { planBulk, BULK_MAX_ITEMS, type BulkItem } from "./bulk-rules";
import { UserFacingError } from "./engagement-rules";

function items(raw: unknown): BulkItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new UserFacingError("Нет изменений", 400);
  if (raw.length > BULK_MAX_ITEMS) throw new UserFacingError(`За один раз можно изменить до ${BULK_MAX_ITEMS} товаров`, 400);
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    return [{
      id: o.id,
      priceRub: o.priceRub === undefined || o.priceRub === null || o.priceRub === "" ? undefined : Number(o.priceRub),
      stockQuantity: o.stockQuantity === undefined || o.stockQuantity === null || o.stockQuantity === "" ? undefined : Number(o.stockQuantity),
    }];
  });
}

export async function applyBulkUpdate(input: { sellerId: string; actorId: string; verified: boolean; items: unknown }) {
  const wanted = items(input.items);
  const products = await prisma.product.findMany({
    where: { sellerId: input.sellerId, id: { in: wanted.map((w) => w.id) } },
    select: { id: true, sku: true, title: true, status: true, priceKopecks: true, oldPriceKopecks: true, inventory: { select: { quantity: true, confirmedBySeller: true, saleUntil: true } } },
  });
  const current = products.map((p) => ({ ...p, quantity: p.inventory?.quantity ?? 0 }));
  const plan = planBulk(current, wanted, { verified: input.verified });
  const invById = new Map(products.map((p) => [p.id, p.inventory]));

  const applyOne = async (change: (typeof plan.changes)[number]) => {
    await prisma.$transaction(async (tx) => {
      if (change.priceTo !== undefined) {
        // Условие на старую цену: если цену успели поменять параллельно, не затираем.
        const updated = await tx.product.updateMany({ where: { id: change.id, priceKopecks: change.priceFrom ?? -1 }, data: { priceKopecks: change.priceTo } });
        if (updated.count !== 1) throw new UserFacingError(`Цена «${change.title}» уже изменилась, обновите страницу`, 409);
        await tx.listingHistory.create({
          data: { productId: change.id, sellerId: input.sellerId, actorId: input.actorId, action: "PRICE_CHANGED", change: JSON.stringify({ priceFrom: change.priceFrom, priceTo: change.priceTo }), note: "массовое изменение" },
        });
      }
      if (change.stockTo !== undefined) {
        const inv = invById.get(change.id);
        await tx.inventory.upsert({
          where: { productId: change.id },
          create: { productId: change.id, quantity: change.stockTo, confirmedBySeller: false, availability: computeAvailability(change.stockTo, false, null) },
          update: { quantity: change.stockTo, availability: computeAvailability(change.stockTo, inv?.confirmedBySeller ?? false, inv?.saleUntil ?? null) },
        });
        await tx.listingHistory.create({
          data: { productId: change.id, sellerId: input.sellerId, actorId: input.actorId, action: "INVENTORY_CHANGED", change: JSON.stringify({ stockQuantity: [change.stockFrom, change.stockTo] }), note: "массовое изменение" },
        });
      }
    });
  };

  const done: typeof plan.changes = [];
  const skipped = [...plan.skipped];
  for (const change of plan.changes) {
    try {
      await applyOne(change);
      done.push(change);
    } catch (e) {
      skipped.push({ title: change.title, reason: e instanceof UserFacingError ? e.message : "не удалось сохранить, попробуйте ещё раз" });
    }
  }
  return { updated: done.length, changes: done, skipped };
}
