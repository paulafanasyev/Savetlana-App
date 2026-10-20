/**
 * Inventory & Listing Lifecycle (spec §9, §10, §11, §24, §55).
 *
 * There are NO platform warehouses in phase one — the goods sit with the
 * seller. So "available" is only as trustworthy as the seller's confirmation,
 * and the platform must never promise guaranteed availability without one.
 *
 * Availability states:
 *   AVAILABLE / LIMITED / OUT_OF_STOCK / PREORDER / MADE_TO_ORDER / UNKNOWN
 *
 * The whole history is append-only: nothing is deleted, only superseded
 * (spec §10: "Никакие данные истории не удалять").
 */
import { prisma } from "../prisma";
import { audit } from "./audit";
import { recordEvent } from "./events";

export type AvailabilityState =
  | "AVAILABLE"
  | "LIMITED"
  | "OUT_OF_STOCK"
  | "PREORDER"
  | "MADE_TO_ORDER"
  | "UNKNOWN";

export const LISTING_DEFAULT_DAYS = 30;

/** Сколько строк остатков разбираем за один запуск: остальное догонит следующий запуск. */
export const SWEEP_BATCH = 500;

export function computeAvailability(
  quantity: number,
  confirmed: boolean,
  saleUntil: Date | null,
  now = new Date()
): AvailabilityState {
  // Zero stock is a hard physical fact, independent of confirmation — we must
  // never report a confirmed-in-stock item the seller cannot actually ship.
  if (quantity <= 0) return "OUT_OF_STOCK";
  // Positive stock without a fresh confirmation is not promiseable (spec §10).
  if (!confirmed) return "UNKNOWN";
  if (saleUntil && saleUntil.getTime() < now.getTime()) return "UNKNOWN";
  if (quantity <= 3) return "LIMITED";
  return "AVAILABLE";
}

/**
 * Seller confirms availability. This is the single authoritative act that
 * un-hides a product and lets the buyer be promised delivery dates.
 * Idempotent: confirming twice just refreshes the timestamp.
 */
export async function confirmAvailability(
  productId: string,
  actorId: string,
  opts: { quantity?: number; extendDays?: number; autoExtend?: boolean; sellerId?: string } = {}
) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { inventory: true, listing: true },
  });
  // Authorization: a seller may only confirm their own inventory (spec §38).
  if (opts.sellerId && product.sellerId !== opts.sellerId) {
    throw new Error("товар принадлежит другому продавцу");
  }

  const now = new Date();
  const extendDays = opts.extendDays ?? LISTING_DEFAULT_DAYS;
  const saleUntil = new Date(now.getTime() + extendDays * 24 * 60 * 60 * 1000);

  const before = {
    confirmed: product.inventory?.confirmedBySeller ?? false,
    quantity: product.inventory?.quantity ?? 0,
    availability: product.inventory?.availability ?? "UNKNOWN",
    saleUntil: product.inventory?.saleUntil ?? null,
  };

  const inventory = await prisma.inventory.upsert({
    where: { productId },
    create: {
      productId,
      quantity: opts.quantity ?? product.inventory?.quantity ?? 1,
      confirmedBySeller: true,
      confirmedAt: now,
      saleUntil,
      autoExtend: opts.autoExtend ?? product.inventory?.autoExtend ?? false,
    },
    update: {
      quantity: opts.quantity ?? product.inventory?.quantity ?? 1,
      confirmedBySeller: true,
      confirmedAt: now,
      saleUntil,
      autoExtend: opts.autoExtend ?? product.inventory?.autoExtend ?? false,
    },
  });

  const availability = computeAvailability(
    inventory.quantity,
    inventory.confirmedBySeller,
    inventory.saleUntil
  );
  await prisma.inventory.update({
    where: { id: inventory.id },
    data: { availability },
  });

  // A fresh confirmation re-lists an expired product (spec §10).
  let listing = product.listing;
  if (!listing || !listing.isLive || (listing.expiresAt && listing.expiresAt < now)) {
    listing = await prisma.listing.upsert({
      where: { productId },
      create: { productId, publishedAt: now, expiresAt: saleUntil, isLive: true },
      update: { publishedAt: now, expiresAt: saleUntil, isLive: true },
    });
  }
  if (product.status === "HIDDEN" || product.status === "DRAFT") {
    await prisma.product.update({ where: { id: productId }, data: { status: "ACTIVE" } });
  }

  await prisma.listingHistory.create({
    data: {
      productId,
      sellerId: product.sellerId,
      action: "AVAILABILITY_CONFIRMED",
      change: JSON.stringify({
        quantity: inventory.quantity,
        availability,
        saleUntil: saleUntil.toISOString(),
        autoExtend: inventory.autoExtend,
      }),
      actorId,
    },
  });

  await audit({
    actorId,
    actorRole: "seller",
    action: "confirm_availability",
    targetType: "Inventory",
    targetId: productId,
    before,
    after: { quantity: inventory.quantity, availability, saleUntil },
  });

  await recordEvent({
    type: "seller_inventory_confirmed",
    userId: actorId,
    productId,
    payload: { quantity: inventory.quantity, availability },
  });

  return { productId, availability, quantity: inventory.quantity, saleUntil, listingId: listing.id };
}

/**
 * Extends the sale window without re-confirming stock quantity.
 */
export async function extendListing(
  productId: string,
  actorId: string,
  extendDaysOrOpts: number | { extendDays?: number; sellerId?: string } = LISTING_DEFAULT_DAYS
) {
  const opts = typeof extendDaysOrOpts === "number" ? { extendDays: extendDaysOrOpts } : extendDaysOrOpts;
  const extendDays = opts.extendDays ?? LISTING_DEFAULT_DAYS;
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { listing: true, inventory: true },
  });
  if (opts.sellerId && product.sellerId !== opts.sellerId) {
    throw new Error("товар принадлежит другому продавцу");
  }
  const now = new Date();
  const base = product.listing?.expiresAt && product.listing.expiresAt > now
    ? product.listing.expiresAt
    : now;
  const expiresAt = new Date(base.getTime() + extendDays * 24 * 60 * 60 * 1000);

  const listing = await prisma.listing.upsert({
    where: { productId },
    create: { productId, expiresAt, isLive: true },
    update: { expiresAt, isLive: true },
  });

  if (product.inventory) {
    await prisma.inventory.update({
      where: { productId },
      data: { saleUntil: expiresAt },
    });
  }

  await prisma.listingHistory.create({
    data: {
      productId,
      sellerId: product.sellerId,
      action: "LISTING_EXTENDED",
      change: JSON.stringify({ expiresAt: expiresAt.toISOString(), extendDays }),
      actorId,
    },
  });

  await recordEvent({
    type: "seller_listing_extended",
    userId: actorId,
    productId,
    payload: { expiresAt: expiresAt.toISOString() },
  });

  return { productId, expiresAt, listingId: listing.id };
}

/**
 * Sweeps the catalog for stale confirmations (spec §10):
 *   - warn the seller
 *   - stop promising guaranteed availability (→ UNKNOWN)
 *   - auto-hide products whose grace period elapsed
 *
 * Берём из базы только те строки, с которыми есть что делать, и не больше
 * SWEEP_BATCH за запуск: уже скрытые товары за пределами льготного срока не
 * разбираем заново, иначе с ростом каталога задача упирается в таймаут.
 *
 * Returns the sweep result so a background job / cron can report it.
 */
export async function sweepStaleAvailability(now = new Date(), batch = SWEEP_BATCH): Promise<{
  warned: string[];
  unknown: string[];
  hidden: string[];
}> {
  const GRACE_DAYS = 7;
  const result = { warned: [] as string[], unknown: [] as string[], hidden: [] as string[] };
  const graceStart = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const needsAction = [{ product: { is: { status: "ACTIVE" } } }, { autoExtend: true }];

  const inventories = await prisma.inventory.findMany({
    where: {
      confirmedBySeller: true,
      OR: [
        // В льготный срок: напоминаем продавцу.
        { saleUntil: { lt: now, gte: graceStart } },
        { saleUntil: null, confirmedAt: { lt: now, gte: graceStart } },
        // После него: только если товар ещё на витрине или продавец включил автопродление.
        ...needsAction.map((extra) => ({ saleUntil: { lt: graceStart }, ...extra })),
        ...needsAction.map((extra) => ({ saleUntil: null, confirmedAt: { lt: graceStart }, ...extra })),
      ],
    },
    orderBy: { saleUntil: "asc" },
    take: batch,
    include: { product: { select: { id: true, sellerId: true, title: true, status: true } } },
  });

  for (const inv of inventories) {
    const staleAt = inv.saleUntil ?? inv.confirmedAt;
    if (!staleAt) continue;
    const ageDays = (now.getTime() - staleAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 0) continue;

    const availability = computeAvailability(inv.quantity, false, inv.saleUntil, now);
    if (inv.availability !== availability) {
      await prisma.inventory.update({
        where: { id: inv.id },
        data: { availability },
      });
    }
    result.unknown.push(inv.productId);

    if (ageDays <= GRACE_DAYS) {
      await notifySeller(
        inv.product.sellerId,
        "availability_expiring",
        "Подтвердите наличие товара",
        `Товар «${inv.product.title}»: срок подтверждения наличия истёк ${Math.floor(
          ageDays
        )} дн. назад. Подтвердите наличие, чтобы товар продолжал отображаться как доступный.`,
        `/seller/products/${inv.productId}`
      );
      result.warned.push(inv.productId);
    } else {
      // Auto-extend only when the seller opted in.
      if (inv.autoExtend) {
        await extendListing(inv.productId, inv.product.sellerId);
        continue;
      }
      if (inv.product.status === "ACTIVE") {
        await prisma.product.update({ where: { id: inv.productId }, data: { status: "HIDDEN" } });
        await prisma.listing.updateMany({
          where: { productId: inv.productId },
          data: { isLive: false },
        });
        await prisma.listingHistory.create({
          data: {
            productId: inv.productId,
            sellerId: inv.product.sellerId,
            action: "AUTO_HIDDEN_STALE_AVAILABILITY",
            change: JSON.stringify({ ageDays: Math.floor(ageDays) }),
          },
        });
        result.hidden.push(inv.productId);
      }
    }
  }
  return result;
}

async function notifySeller(
  sellerId: string,
  kind: string,
  title: string,
  body: string,
  url?: string
) {
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerId } });
  if (!seller) return;
  await prisma.notification.create({
    data: { userId: seller.userId, kind, title, body, url },
  });
}
