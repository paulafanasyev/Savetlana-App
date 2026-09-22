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
import { getCartView } from "./cart";
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
      select: { id: true, number: true, status: true, buyerId: true, sellerId: true },
    });
    if (input.actorRole === "buyer" && order.buyerId !== (input.actingUserId ?? input.actorId)) {
      throw new Error("нет прав на изменение этого заказа");
    }
    if (
      (input.actorRole === "seller" || input.actorRole === "admin") &&
      input.actingSellerId &&
      order.sellerId !== input.actingSellerId
    ) {
      throw new Error("заказ принадлежит другому продавцу");
    }
    const to = input.to;
    if (order.status === to) {
      return { ok: true, from: order.status, to, note: "already in state", order: { id: order.id, number: order.number, status: order.status } };
    }
    if (!canTransition(order.status, to)) {
      throw new Error(`недопустимый переход статуса заказа: ${order.status} → ${to}`);
    }
    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: {
        status: to,
        cancelledAt: to === "CANCELLED" ? new Date() : undefined,
        completedAt: to === "COMPLETED" ? new Date() : undefined,
        confirmedAt: to === "CONFIRMED" ? new Date() : undefined,
      },
      select: { id: true, number: true, status: true },
    });
    await tx.orderHistory.create({
      data: {
        orderId: input.orderId,
        fromStatus: order.status,
        toStatus: to,
        reason: input.note,
        actorId: input.actorId,
      },
    });
    return { ok: true, from: order.status, to, note: input.note, order: updated };
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
