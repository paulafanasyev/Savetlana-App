/**
 * Order Engine (spec §29, §37, §124, §125, §164).
 *
 * - multi-seller cart → one order per seller
 * - explicit state machine; every transition is journaled
 * - idempotent creation (same idempotency key → same orders)
 * - the AI can create orders but NEVER marks them paid on its own authority
 */
import { prisma } from "../prisma";
import { generateOrderNumber } from "../utils";
import { getCartView, type CartLine } from "./cart";
import { computeSettlement } from "./payments";

export const ORDER_STATES = [
  "CREATED",
  "PAYMENT_PENDING",
  "PAID",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "HANDED_TO_CARRIER",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURNING",
  "REFUNDED",
  "DISPUTED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const TRANSITIONS: Record<string, string[]> = {
  CREATED: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "CANCELLED"],
  PAID: ["CONFIRMED", "DISPUTED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "DISPUTED"],
  PROCESSING: ["READY", "HANDED_TO_CARRIER", "DISPUTED"],
  READY: ["HANDED_TO_CARRIER", "DISPUTED"],
  HANDED_TO_CARRIER: ["IN_TRANSIT", "DISPUTED"],
  IN_TRANSIT: ["DELIVERED", "DISPUTED"],
  DELIVERED: ["COMPLETED", "RETURN_REQUESTED", "DISPUTED"],
  COMPLETED: ["RETURN_REQUESTED", "DISPUTED"],
  RETURN_REQUESTED: ["RETURNING", "COMPLETED", "DISPUTED"],
  RETURNING: ["REFUNDED", "COMPLETED", "DISPUTED"],
  REFUNDED: [],
  DISPUTED: ["COMPLETED", "REFUNDED", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface CreateOrderInput {
  buyerId: string;
  deliveryAddress: {
    city?: string;
    street?: string;
    house?: string;
    apartment?: string;
    zip?: string;
    recipientName?: string;
    phone?: string;
  };
  note?: string;
  /** Caller-supplied idempotency key (spec §125). */
  idempotencyKey: string;
}

export interface CreatedOrders {
  groupId: string;
  orders: Array<{
    id: string;
    number: string;
    sellerId: string;
    totalKopecks: number;
    itemsCount: number;
  }>;
}

/**
 * Checkout: splits the cart by seller and creates one order per seller
 * atomically. If the cart is empty or a line went unavailable, nothing is
 * created — the buyer is never charged for something we cannot fulfil.
 */
export async function createOrdersFromCart(
  input: CreateOrderInput
): Promise<CreatedOrders> {
  // Idempotency first: a repeated checkout with the same key returns the
  // original group instead of creating duplicate orders. This check must run
  // before the cart validation — a replay after a successful checkout finds an
  // already-cleared cart and would otherwise wrongly throw (spec §125).
  const existingGroup = await prisma.orderGroup.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { orders: { select: { id: true, number: true, sellerId: true, totalKopecks: true, _count: { select: { items: true } } } } },
  });
  if (existingGroup) {
    return {
      groupId: existingGroup.id,
      orders: existingGroup.orders.map((o) => ({
        id: o.id,
        number: o.number,
        sellerId: o.sellerId,
        totalKopecks: o.totalKopecks,
        itemsCount: o._count.items,
      })),
    };
  }

  const cart = await getCartView(input.buyerId);
  if (cart.lines.length === 0) {
    throw new Error("корзина пуста");
  }
  const unavailable = cart.lines.filter((l) => !l.available);
  if (unavailable.length > 0) {
    throw new Error(
      `часть товаров недоступна в нужном количестве: ${unavailable
        .map((l) => l.title)
        .join(", ")}`
    );
  }

  const bySeller = new Map<string, typeof cart.lines>();
  for (const line of cart.lines) {
    const arr = bySeller.get(line.sellerId) ?? [];
    arr.push(line);
    bySeller.set(line.sellerId, arr);
  }

  const addressJson = JSON.stringify(input.deliveryAddress);

  return prisma.$transaction(async (tx) => {
    // --- Atomic stock reservation (P0 fix, spec §6/§124) --------------------
    // The pre-transaction read-only check is not authoritative: two concurrent
    // checkouts could both see stock>=qty and both succeed. Here every unit is
    // claimed with a conditional decrement guarded on the *current* row value,
    // so under concurrency at most one writer can win the last item. A failure
    // aborts the whole transaction — no order is left without its stock.
    const reserved = await reserveStock(tx, cart.lines);
    if (reserved.length > 0) {
      throw new Error(
        `часть товаров закончилась: ${reserved
          .map((r) => `${r.title} (осталось ${r.remaining})`)
          .join(", ")}`
      );
    }

    const group = await tx.orderGroup.create({
      data: {
        id: input.idempotencyKey,
        buyerId: input.buyerId,
        idempotencyKey: input.idempotencyKey,
      },
    });

    const created: CreatedOrders["orders"] = [];
    for (const [sellerId, lines] of bySeller) {
      const subtotal = lines.reduce((s, l) => s + l.lineTotalKopecks, 0);
      const settlement = computeSettlement({ grossKopecks: subtotal });
      const order = await tx.order.create({
        data: {
          groupId: group.id,
          buyerId: input.buyerId,
          sellerId,
          number: generateOrderNumber(),
          status: "CREATED",
          subtotalKopecks: subtotal,
          deliveryKopecks: 0, // delivery chosen at/after confirmation
          platformFeeKopecks: settlement.platformFeeKopecks,
          paymentFeeKopecks: settlement.paymentFeeKopecks,
          totalKopecks: subtotal,
          deliveryAddress: addressJson,
          note: input.note,
        },
      });
      await tx.orderItem.createMany({
        data: lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          titleSnapshot: l.title,
          priceKopecks: l.priceKopecks,
          quantity: l.quantity,
          imageUrl: l.image,
        })),
      });
      await tx.orderHistory.create({
        data: { orderId: order.id, toStatus: "CREATED", reason: "checkout", actorId: input.buyerId },
      });
      // Checkout hands the order to the payment step immediately. Transitioning
      // here (rather than letting the payment layer write PAID straight over
      // CREATED) keeps a single authoritative state machine (spec §124).
      await tx.order.update({ where: { id: order.id }, data: { status: "PAYMENT_PENDING" } });
      await tx.orderHistory.create({
        data: { orderId: order.id, toStatus: "PAYMENT_PENDING", reason: "awaiting payment", actorId: input.buyerId },
      });
      created.push({
        id: order.id,
        number: order.number,
        sellerId,
        totalKopecks: subtotal,
        itemsCount: lines.length,
      });
    }

    // The cart is cleared only after the orders are durably written.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return { groupId: group.id, orders: created };
  });
}

type TransactionClient = Parameters<Parameters<typeof prisma["$transaction"]>[0]>[0];

/**
 * Claims stock atomically for every cart line. Each line is a conditional
 * `UPDATE ... WHERE quantity >= needed`; under concurrency the database's own
 * row locking makes this the single source of truth, so two simultaneous
 * checkouts of the last item cannot both succeed (P0 overselling fix).
 *
 * Returns the lines that could not be fulfilled with the remaining quantity,
 * so the caller can abort with an honest, specific message.
 */
async function reserveStock(
  tx: TransactionClient,
  lines: CartLine[]
): Promise<{ title: string; remaining: number }[]> {
  const failed: { title: string; remaining: number }[] = [];
  for (const line of lines) {
    const result = await tx.inventory.updateMany({
      where: { productId: line.productId, quantity: { gte: line.quantity } },
      data: { quantity: { decrement: line.quantity } },
    });
    if (result.count !== 1) {
      const inventory = await tx.inventory.findUnique({
        where: { productId: line.productId },
        select: { quantity: true },
      });
      failed.push({ title: line.title, remaining: inventory?.quantity ?? 0 });
    }
  }
  return failed;
}

/**
 * Returns reserved stock to inventory when an order is cancelled or refunded
 * (spec §10, §29). Idempotent: the restoration is recorded on the order so a
 * repeated transition does not double-credit the seller.
 */
export async function releaseStockForOrder(
  tx: TransactionClient,
  order: { id: string; items: { productId: string; quantity: number }[] }
): Promise<void> {
  for (const item of order.items) {
    await tx.inventory.updateMany({
      where: { productId: item.productId },
      data: { quantity: { increment: item.quantity } },
    });
  }
}

export interface TransitionInput {
  orderId: string;
  to: OrderState;
  note?: string;
  actorId: string;
  actorRole: "buyer" | "seller" | "admin" | "system";
  /**
   * The user the actor is acting for. When the actor is a buyer, this must
   * match the order's buyer — the AI may never transition someone else's
   * order (spec §38: authorization on every sensitive backend action).
   */
  actingUserId?: string;
  /** For seller/admin transitions, which seller profile is authorised. */
  actingSellerId?: string;
}

export async function transitionOrder(
  input: TransitionInput
): Promise<{ ok: boolean; from: string; to: string; note?: string; order: { id: string; number: string; status: string } }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: {
        items: { select: { productId: true, quantity: true } },
        _count: { select: { items: true } },
      },
    });
    const orderMeta = {
      id: order.id,
      number: order.number,
      status: order.status,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      stockReleased: order.stockReleased,
    };
    if (input.actorRole === "buyer" && orderMeta.buyerId !== (input.actingUserId ?? input.actorId)) {
      throw new Error("нет прав на изменение этого заказа");
    }
    if (
      (input.actorRole === "seller" || input.actorRole === "admin") &&
      input.actingSellerId &&
      orderMeta.sellerId !== input.actingSellerId
    ) {
      throw new Error("заказ принадлежит другому продавцу");
    }
    const to = input.to;
    if (orderMeta.status === to) {
      return { ok: true, from: orderMeta.status, to, note: "already in state", order: { id: orderMeta.id, number: orderMeta.number, status: orderMeta.status } };
    }
    if (!canTransition(orderMeta.status, to)) {
      throw new Error(`недопустимый переход статуса заказа: ${orderMeta.status} → ${to}`);
    }
    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: {
        status: to,
        cancelledAt: to === "CANCELLED" ? new Date() : undefined,
        completedAt: to === "COMPLETED" ? new Date() : undefined,
        confirmedAt: to === "CONFIRMED" ? new Date() : undefined,
        // Stock was reserved at checkout; give it back exactly once when the
        // order terminates without fulfilment (P0 overselling fix).
        stockReleased: to === "CANCELLED" || to === "REFUNDED" ? true : undefined,
      },
      select: { id: true, number: true, status: true },
    });
    if ((to === "CANCELLED" || to === "REFUNDED") && !orderMeta.stockReleased) {
      await releaseStockForOrder(tx, order);
    }
    await tx.orderHistory.create({
      data: {
        orderId: input.orderId,
        fromStatus: orderMeta.status,
        toStatus: to,
        reason: input.note,
        actorId: input.actorId,
      },
    });
    return { ok: true, from: orderMeta.status, to, note: input.note, order: updated };
  });
}

export async function getOrdersForBuyer(buyerId: string) {
  return prisma.order.findMany({
    where: { buyerId },
    orderBy: { createdAt: "desc" },
    include: {
      items: true,
      sellerProfile: { select: { id: true, displayName: true, identityStatus: true, businessStatus: true } },
      shipment: true,
      payment: { select: { status: true, sandbox: true, provider: true } },
    },
  });
}

export async function getOrdersForSeller(sellerProfileId: string) {
  return prisma.order.findMany({
    where: { sellerId: sellerProfileId },
    orderBy: { createdAt: "desc" },
    include: {
      items: true,
      buyer: { select: { name: true, email: true } },
      shipment: true,
      payment: { select: { status: true, sandbox: true } },
    },
  });
}
