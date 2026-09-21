/**
 * Cart (spec §37, §38).
 *
 * One cart may hold products from several sellers. On checkout the cart is
 * split into one order per seller — delivery, payouts and statuses are then
 * tracked per seller while the buyer sees one simple picture.
 */
import { prisma } from "../prisma";
import { toKopecks, fromKopecks } from "../utils";

export interface CartLine {
  id: string;
  productId: string;
  title: string;
  image: string | null;
  priceKopecks: number;
  quantity: number;
  sellerId: string;
  sellerName: string;
  available: boolean;
  lineTotalKopecks: number;
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
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const lines: CartLine[] = cart.items.map((item) => {
    const stock = item.product.inventory?.quantity ?? 0;
    return {
      id: item.id,
      productId: item.productId,
      title: item.product.title,
      image: item.product.images[0]?.url ?? null,
      priceKopecks: item.product.priceKopecks,
      quantity: item.quantity,
      sellerId: item.product.sellerId,
      sellerName: item.product.sellerProfile.displayName,
      available:
        item.product.status === "ACTIVE" &&
        stock >= item.quantity &&
        (item.product.inventory?.availability ?? "UNKNOWN") !== "OUT_OF_STOCK",
      lineTotalKopecks: item.product.priceKopecks * item.quantity,
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
  quantity = 1
): Promise<CartView> {
  const cartId = await getOrCreateCart(userId);
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
  });
  if (product.status !== "ACTIVE") {
    throw new Error("товар не опубликован");
  }
  const q = Math.max(1, Math.min(quantity, 99));
  const existing = await prisma.cartItem.findFirst({
    where: { cartId, productId, variantId: null },
  });
  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: Math.min(99, existing.quantity + q) },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId, productId, quantity: q, priceKopecks: product.priceKopecks },
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
