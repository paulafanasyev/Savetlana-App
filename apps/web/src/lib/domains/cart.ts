/**
 * Cart (spec §37, §38).
 *
 * One cart may hold products from several sellers. On checkout the cart is
 * split into one order per seller: delivery, payouts and statuses are then
 * tracked per seller while the buyer sees one simple picture.
 */
import { prisma } from "../prisma";
import { toKopecks, fromKopecks } from "../utils";

export interface CartLine {
  id: string;
  productId: string;
  variantId: string | null;
  variantName: string | null;
  title: string;
  image: string | null;
  priceKopecks: number;
  quantity: number;
  sellerId: string;
  sellerName: string;
  available: boolean;
  /** Сколько штук сейчас есть у продавца. */
  stock: number;
  lineTotalKopecks: number;
  /** True when the live price differs from the price-at-add snapshot. */
  priceChanged: boolean;
  priceSnapshotKopecks: number;
  priceLiveKopecks: number;
}

export interface CartView {
  id: string;
  lines: CartLine[];
  totalKopecks: number;
  totalUnits: number;
  /** How many distinct sellers the cart spans. */
  sellerCount: number;
}

export async function getOrCreateCart(userId: string): Promise<string> {
  const existing = await prisma.cart.findFirst({ where: { userId } });
  if (existing) return existing.id;
  const created = await prisma.cart.create({ data: { userId } });
  return created.id;
}

export async function getCartView(userId: string): Promise<CartView> {
  const cartId = await getOrCreateCart(userId);
  const cart = await prisma.cart.findUniqueOrThrow({
    where: { id: cartId },
    include: {
      items: {
        include: {
          product: {
            include: {
              sellerProfile: { select: { displayName: true } },
              images: { take: 1, orderBy: { position: "asc" } },
              inventory: { select: { quantity: true, availability: true } },
              variants: { select: { id: true, name: true, priceDelta: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const lines: CartLine[] = cart.items.map((item) => {
    const stock = item.product.inventory?.quantity ?? 0;
    const variant = item.variantId ? item.product.variants.find((v) => v.id === item.variantId) ?? null : null;
    // Price snapshot policy (P0 fix, spec §9): the buyer is charged the price
    // they saw when the item was added, never a silent increase. A lower live
    // price is passed on; either way the change is surfaced at checkout.
    const livePrice = item.product.priceKopecks + (variant?.priceDelta ?? 0);
    const snapshotPrice = item.priceKopecks;
    const priceKopecks = Math.min(snapshotPrice, livePrice);
    return {
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      variantName: variant?.name ?? null,
      title: variant ? `${item.product.title} (${variant.name})` : item.product.title,
      image: item.product.images[0]?.url ?? null,
      priceKopecks,
      quantity: item.quantity,
      sellerId: item.product.sellerId,
      sellerName: item.product.sellerProfile.displayName,
      available:
        item.product.status === "ACTIVE" &&
        stock >= item.quantity &&
        (!item.variantId || Boolean(variant)) &&
        (item.product.inventory?.availability ?? "UNKNOWN") !== "OUT_OF_STOCK",
      stock,
      lineTotalKopecks: priceKopecks * item.quantity,
      priceChanged: livePrice !== snapshotPrice,
      priceSnapshotKopecks: snapshotPrice,
      priceLiveKopecks: livePrice,
    };
  });

  const totalKopecks = lines.reduce((sum, l) => sum + l.lineTotalKopecks, 0);
  return {
    id: cartId,
    lines,
    totalKopecks,
    totalUnits: lines.reduce((sum, l) => sum + l.quantity, 0),
    sellerCount: new Set(lines.map((l) => l.sellerId)).size,
  };
}

export async function addToCart(
  userId: string,
  productId: string,
  quantity = 1,
  variantId?: string | null
): Promise<CartView> {
  const cartId = await getOrCreateCart(userId);
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { inventory: { select: { quantity: true, availability: true } }, variants: { select: { id: true, priceDelta: true } } },
  });
  if (product.status !== "ACTIVE") {
    throw new Error("товар не опубликован");
  }
  const variant = variantId ? product.variants.find((v) => v.id === variantId) ?? null : null;
  if (variantId && !variant) throw new Error("такого варианта товара нет");
  // Не даём положить то, чего нет: иначе покупатель застрянет на оформлении.
  const stock = product.inventory ? product.inventory.quantity : null;
  if (product.inventory && (product.inventory.quantity <= 0 || product.inventory.availability === "OUT_OF_STOCK")) {
    throw new Error("товар закончился");
  }
  const q = Math.max(1, Math.min(quantity, 99));
  const existing = await prisma.cartItem.findFirst({
    where: { cartId, productId, variantId: variant?.id ?? null },
  });
  const wanted = Math.min(99, (existing?.quantity ?? 0) + q);
  if (stock !== null && wanted > stock) {
    throw new Error(`в наличии только ${stock} шт.`);
  }
  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: wanted },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId, productId, variantId: variant?.id ?? null, quantity: q, priceKopecks: product.priceKopecks + (variant?.priceDelta ?? 0) },
    });
  }
  return getCartView(userId);
}

export async function setCartLineQuantity(
  userId: string,
  lineId: string,
  quantity: number
): Promise<CartView> {
  const cartId = await getOrCreateCart(userId);
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { id: lineId, cartId } });
  } else {
    await prisma.cartItem.updateMany({
      where: { id: lineId, cartId },
      data: { quantity: Math.min(99, quantity) },
    });
  }
  return getCartView(userId);
}

export async function clearCart(userId: string): Promise<void> {
  const cartId = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId } });
}

export { toKopecks, fromKopecks };
