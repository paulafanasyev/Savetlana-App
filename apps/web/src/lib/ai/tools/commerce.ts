/**
 * Commerce tools: orders, cart and wishlist.
 *
 * Order creation and cancellation are FINANCIAL/HIGH_RISK writes — they always
 * require explicit confirmation and the result is verified against the
 * authoritative store before the agent is allowed to report success (spec §47).
 */
import { getCartView, addToCart } from "../../domains/cart";
import { createOrdersFromCart, getOrdersForBuyer, transitionOrder } from "../../domains/orders";
import { openDispute } from "../../domains/disputes";
import { syncTracking } from "../../domains/delivery";
import { computeAvailability } from "../../domains/inventory";
import { prisma } from "../../prisma";
import { fromKopecks, generateOrderNumber } from "../../utils";
import type { ToolDefinition, ToolResult, ToolContext } from "./registry";
import { looseObjectSchema } from "./registry";
import { recordEvent } from "../../domains/events";
import { notify } from "../../domains/notifications";

function ok(data: unknown, summary: string): ToolResult {
  return { ok: true, data, summary, verification: "VERIFIED" };
}
function denied(reason: string): ToolResult {
  return { ok: false, error: reason, verification: "NOT_PROVEN" };
}

export const getOrderTool: ToolDefinition = {
  name: "get_order",
  description: "Показать заказы покупателя и реальные статусы доставок. Не выдумывает статус.",
  permission: "READ_ORDERS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({ orderId: { type: "string" }, mine: { type: "boolean" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.orderId === "string") {
      const order = await prisma.order.findFirst({
        where: { id: args.orderId, buyerId: ctx.userId },
        include: {
          items: true,
          payment: true,
          shipment: { include: { events: true } },
        },
      });
      if (!order) return denied("заказ не найден");
      return ok(describeOrder(order), describeOrderSummary(order));
    }
    const orders = await getOrdersForBuyer(ctx.userId);
    if (orders.length === 0) return ok({ items: [] }, "У вас пока нет заказов.");
    return ok(
      { items: orders.map(describeOrder) },
      `У вас ${orders.length} заказов. Последний: ${describeOrderSummary(orders[0])}`
    );
  },
};

/** Structural presentation helper — tolerant of which includes the caller used. */
interface OrderView {
  id: string;
  number: string;
  status: string;
  totalKopecks: number;
  createdAt: Date;
  items: Array<{ titleSnapshot: string; quantity: number; priceKopecks: number }>;
  payment?: { status: string; sandbox: boolean; provider?: string; providerRef?: string | null } | null;
  shipment?: {
    carrierName?: string;
    trackingNumber?: string | null;
    status?: string;
    eta?: Date | null;
    events?: Array<{ status: string; note?: string | null; description?: string | null; occurredAt: Date }>;
  } | null;
}

function describeOrder(o: OrderView) {
  const events = o.shipment?.events ?? [];
  return {
    orderId: o.id,
    number: o.number,
    status: o.status,
    totalKopecks: o.totalKopecks,
    totalRub: fromKopecks(o.totalKopecks),
    items: o.items.map((i) => ({ title: i.titleSnapshot, qty: i.quantity, priceKopecks: i.priceKopecks })),
    paymentStatus: o.payment?.status ?? "нет данных об оплате",
    paymentIsSandbox: o.payment?.sandbox ?? false,
    shipment: o.shipment
      ? {
          carrier: o.shipment.carrierName ?? null,
          trackingNumber: o.shipment.trackingNumber ?? null,
          status: o.shipment.status ?? null,
          eta: o.shipment.eta ?? null,
          events: events.map((e) => ({
            status: e.status,
            note: e.note ?? e.description ?? null,
            at: e.occurredAt,
          })),
        }
      : null,
  };
}
function describeOrderSummary(o: OrderView): string {
  return `заказ ${o.number}: статус ${o.status}, сумма ${fromKopecks(o.totalKopecks)} ₽`;
}

export const cartAddTool: ToolDefinition = {
  name: "cart_add",
  description: "Добавить товар в корзину покупателя.",
  permission: "CART_WRITE",
  riskLevel: "LOW_RISK_WRITE",
  // Adding to cart is reversible and touches no money.
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string" },
    quantity: { type: "number" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.productId !== "string") return denied("укажите productId");
    const qty = typeof args.quantity === "number" ? args.quantity : 1;
    try {
      const view = await addToCart(ctx.userId, args.productId, qty);
      await recordEvent({
        userId: ctx.userId,
        type: "CART_ADD",
        productId: args.productId,
        payload: { quantity: qty },
      });
      return ok(
        { lines: view.lines.length, totalKopecks: view.totalKopecks },
        `Добавила в корзину. Сейчас в корзине ${view.lines.length} позиций на ${fromKopecks(view.totalKopecks)} ₽.`
      );
    } catch (e) {
      return denied(e instanceof Error ? e.message : "не удалось добавить товар");
    }
  },
};

export const createOrderTool: ToolDefinition = {
  name: "create_order",
  description:
    "Оформить заказ из корзины. Разделяет корзину на отдельные заказы по продавцам. Требует подтверждения пользователя.",
  permission: "CREATE_ORDER",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({
    idempotencyKey: { type: "string" },
    deliveryAddress: { type: "object" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const view = await getCartView(ctx.userId);
    if (view.lines.length === 0) return denied("корзина пуста");
    try {
      const created = await createOrdersFromCart({
        buyerId: ctx.userId,
        idempotencyKey:
          typeof args.idempotencyKey === "string" ? args.idempotencyKey : cryptoRandom(),
        deliveryAddress: validDeliveryAddress(args.deliveryAddress),
      });
      await recordEvent({
        userId: ctx.userId,
        type: "PURCHASE",
        payload: { orderIds: created.orders.map((o) => o.id) },
      });
      const total = created.orders.reduce((s, o) => s + o.totalKopecks, 0);
      return ok(
        {
          orderIds: created.orders.map((o) => o.id),
          numbers: created.orders.map((o) => o.number),
          sellers: created.orders.map((o) => o.sellerId),
          totalKopecks: total,
        },
        `Оформлено заказов: ${created.orders.length}, на сумму ${fromKopecks(total)} ₽. Ожидают оплаты.`
      );
    } catch (e) {
      return denied(e instanceof Error ? e.message : "не удалось создать заказ");
    }
  },
};

export const cancelOrderTool: ToolDefinition = {
  name: "cancel_order",
  description: "Отменить заказ, если статус это позволяет. Требует подтверждения пользователя.",
  permission: "CANCEL_ORDER",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({ orderId: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const orderId = typeof args.orderId === "string" ? args.orderId : undefined;
    if (!orderId) return denied("укажите orderId");
    try {
      const result = await transitionOrder({
        orderId,
        actorId: ctx.userId,
        actorRole: "buyer",
        actingUserId: ctx.userId,
        to: "CANCELLED",
        note: "отмена пользователем через ассистента",
      });
      if (!result.ok) {
        return denied(`не удалось отменить заказ: ${result.note ?? "недопустимый переход статуса"}`);
      }
      const order = result.order;
      await notify({
        userId: ctx.userId,
        kind: "order_status",
        title: `Заказ ${order.number} отменён`,
        body: "Отмена выполнена. Деньги вернутся по правилам платёжного партнёра.",
        url: `/orders/${order.id}`,
      });
      return ok({ orderId: order.id, status: order.status }, `Заказ ${order.number} отменён.`);
    } catch (e) {
      return denied(e instanceof Error ? e.message : "отмена невозможна в текущем статусе");
    }
  },
};

export const wishlistAddTool: ToolDefinition = {
  name: "wishlist_add",
  description: "Добавить товар в список желаний.",
  permission: "WISHLIST_WRITE",
  riskLevel: "LOW_RISK_WRITE",
  needsConfirmation: false,
  parameters: looseObjectSchema({ productId: { type: "string" }, note: { type: "string" } }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.productId !== "string") return denied("укажите productId");
    const list = await prisma.wishlist.findFirst({ where: { userId: ctx.userId } });
    const wishlist = list ?? (await prisma.wishlist.create({ data: { userId: ctx.userId } }));
    await prisma.wishlistItem.upsert({
      where: { wishlistId_productId: { wishlistId: wishlist.id, productId: args.productId } },
      create: {
        wishlistId: wishlist.id,
        userId: ctx.userId,
        productId: args.productId,
        note: typeof args.note === "string" ? args.note.slice(0, 300) : undefined,
      },
      update: {},
    });
    await recordEvent({
      userId: ctx.userId,
      type: "WISHLIST_ADD",
      productId: args.productId,
    });
    return ok({ productId: args.productId }, "Добавила в список желаний.");
  },
};

function cryptoRandom(): string {
  return generateOrderNumber();
}

function validDeliveryAddress(
  raw: unknown
): {
  city?: string;
  street?: string;
  house?: string;
  apartment?: string;
  zip?: string;
  recipientName?: string;
  phone?: string;
} {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof obj[k] === "string" ? String(obj[k]).slice(0, 200) : undefined;
  const out: Record<string, string> = {};
  for (const k of ["city", "street", "house", "apartment", "zip", "recipientName", "phone"]) {
    const v = str(k);
    if (v) out[k] = v;
  }
  return out;
}

const RETURN_REASONS = [
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_DAMAGED",
  "WRONG_ITEM",
  "NO_LONGER_NEEDED",
] as const;

/**
 * Request a return on a delivered/completed order (spec §29 return states).
 * The order state machine must permit RETURN_REQUESTED — this tool never
 * fabricates the transition; it verifies the persisted state afterwards.
 */
export const requestReturnTool: ToolDefinition = {
  name: "request_return",
  description:
    "Запросить возврат товара. Доступно только для доставленных или завершённых заказов. Требует подтверждения пользователя.",
  permission: "REQUEST_RETURN",
  riskLevel: "FINANCIAL",
  needsConfirmation: true,
  parameters: looseObjectSchema({
    orderId: { type: "string" },
    reason: { type: "string" },
    comment: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const orderId = typeof args.orderId === "string" ? args.orderId : undefined;
    if (!orderId) return denied("укажите orderId");
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    if (!reason || !RETURN_REASONS.includes(reason as never)) {
      return denied(`укажите причину: ${RETURN_REASONS.join(", ")}`);
    }
    const comment = typeof args.comment === "string" ? args.comment.slice(0, 1000) : undefined;

    try {
      const result = await transitionOrder({
        orderId,
        actorId: ctx.userId,
        actorRole: "buyer",
        actingUserId: ctx.userId,
        to: "RETURN_REQUESTED",
        note: comment ?? `возврат: ${reason}`,
      });
      if (!result.ok) {
        return denied(`невозможно запросить возврат: ${result.note ?? "недопустимый статус заказа"}`);
      }
      const order = result.order;
      await notify({
        userId: ctx.userId,
        kind: "order_status",
        title: `Оформлен возврат по заказу ${order.number}`,
        body: "Запрос передан продавцу. Если он не ответит в срок, спор можно эскалировать.",
        url: `/orders/${order.id}`,
      });
      return ok(
        { orderId: order.id, status: order.status, reason },
        `Оформила запрос на возврат по заказу ${order.number}. Статус: возврат запрошен.`
      );
    } catch (e) {
      return denied(e instanceof Error ? e.message : "не удалось оформить возврат");
    }
  },
};

const DISPUTE_REASONS = [
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_DAMAGED",
  "PAYMENT_DISPUTE",
  "RETURN_DISPUTE",
  "DELIVERY_DISPUTE",
] as const;

/**
 * Open a dispute (spec §42). Svetlana collects the request and evidence, but
 * the final verdict on a dispute requiring adjudication belongs to a human
 * (ESCALATED_HUMAN) — never to the AI.
 */
export const createDisputeTool: ToolDefinition = {
  name: "create_dispute",
  description:
    "Открыть спор по заказу. Используется, если продавец не решил проблему. Сбор доказательств автоматический, итоговое решение принимает человек.",
  permission: "CREATE_DISPUTE",
  riskLevel: "HIGH_RISK_WRITE",
  needsConfirmation: true,
  parameters: looseObjectSchema({
    orderId: { type: "string" },
    reason: { type: "string" },
    description: { type: "string" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const orderId = typeof args.orderId === "string" ? args.orderId : undefined;
    if (!orderId) return denied("укажите orderId");
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    if (!reason || !DISPUTE_REASONS.includes(reason as never)) {
      return denied(`укажите причину: ${DISPUTE_REASONS.join(", ")}`);
    }
    const description =
      typeof args.description === "string" && args.description.trim().length >= 10
        ? args.description.slice(0, 2000)
        : undefined;
    if (!description) return denied("опишите проблему (минимум 10 символов)");

    try {
      const dispute = await openDispute({
        orderId,
        buyerId: ctx.userId,
        reason: reason as never,
        description,
      });
      await notify({
        userId: ctx.userId,
        kind: "dispute_update",
        title: `Открыт спор по заказу ${dispute.orderId}`,
        body: "Спор передан на сбор доказательств. Если потребуется, подключится специалист.",
        url: `/orders/${orderId}`,
      });
      return ok(
        { disputeId: dispute.id, status: dispute.status },
        `Открыла спор по заказу. Статус: сбор доказательств. Итоговое решение принимает человек, не я.`
      );
    } catch (e) {
      return denied(e instanceof Error ? e.message : "не удалось открыть спор");
    }
  },
};

/**
 * get_tracking (spec §24, §34, §44) — единый экран отслеживания для AI.
 * Статус берётся у реального перевозчика; если адаптера нет (продавец
 * объявил свою доставку или PENDING_EXTERNAL_ACCESS) — хронология отдаётся
 * как есть. Никаких выдуманных статусов (spec §49, §123).
 */
export const getTrackingTool: ToolDefinition = {
  name: "get_tracking",
  description:
    "Реальное отслеживание заказа: перевозчик, трек-номер, ETA и хронология событий. Отвечает на «где мой заказ?» по данным перевозчика.",
  permission: "READ_TRACKING",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    orderId: { type: "string", description: "идентификатор заказа" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const orderId = typeof args.orderId === "string" ? args.orderId : undefined;
    if (!orderId) return denied("укажите orderId заказа");

    const order = await prisma.order.findFirst({
      where: { id: orderId, buyerId: ctx.userId },
      select: { id: true, number: true, status: true },
    });
    if (!order) return denied("заказ не найден или принадлежит другому пользователю");

    let shipment = await prisma.deliveryShipment.findFirst({
      where: { orderId: order.id },
      include: { events: { orderBy: { occurredAt: "asc" } } },
    });

    if (shipment) {
      // Refresh from the carrier when an adapter exists. A carrier outage must
      // not break the answer: fall back to the last known persisted state.
      try {
        shipment = (await syncTracking(shipment.id)) as typeof shipment;
      } catch {
        // keep persisted timeline
      }
    }

    if (!shipment) {
      return ok(
        { orderNumber: order.number, orderStatus: order.status, shipment: null },
        `Заказ ${order.number} ещё не передан в доставку. Статус заказа: ${order.status}.`
      );
    }

    const events = shipment.events.map((e) => ({
      status: e.status,
      description: e.description,
      occurredAt: e.occurredAt.toISOString(),
    }));
    const eta = shipment.eta ? shipment.eta.toISOString() : null;

    return ok(
      {
        orderNumber: order.number,
        orderStatus: order.status,
        shipment: {
          carrierName: shipment.carrierName,
          trackingNumber: shipment.trackingNumber,
          status: shipment.status,
          eta,
          events,
        },
      },
      `Заказ ${order.number}, статус: ${shipment.status}.` +
        (shipment.trackingNumber ? ` Трек-номер: ${shipment.trackingNumber}.` : "") +
        (events.length > 0 ? ` Последнее событие: ${events[events.length - 1].description ?? events[events.length - 1].status}.` : "")
    );
  },
};

/**
 * get_payment_status (spec §44, §26) — статус оплаты и распределения средств
 * по модели BUYER → PAYMENT PROVIDER → SETTLEMENT → SELLER PAYOUT.
 */
export const getPaymentStatusTool: ToolDefinition = {
  name: "get_payment_status",
  description:
    "Статус оплаты заказа: платёж, его sandbox-природу и состояние расчётов с продавцом.",
  permission: "READ_ORDERS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    orderId: { type: "string", description: "идентификатор заказа" },
  }),
  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const orderId = typeof args.orderId === "string" ? args.orderId : undefined;
    if (!orderId) return denied("укажите orderId заказа");

    const order = await prisma.order.findFirst({
      where: { id: orderId, buyerId: ctx.userId },
      select: {
        id: true,
        number: true,
        status: true,
        totalKopecks: true,
        payment: { select: { status: true, sandbox: true, provider: true, providerRef: true } },
      },
    });
    if (!order) return denied("заказ не найден или принадлежит другому пользователю");

    return ok(
      {
        orderNumber: order.number,
        orderStatus: order.status,
        totalRub: fromKopecks(order.totalKopecks),
        payment: order.payment
          ? {
              status: order.payment.status,
              sandbox: order.payment.sandbox,
              provider: order.payment.provider,
            }
          : null,
      },
      order.payment
        ? `Оплата заказа ${order.number}: ${order.payment.status} через ${order.payment.provider}.` +
            (order.payment.sandbox ? " Внимание: это тестовая среда, реальное списание не проводилось." : "")
        : `Заказ ${order.number} ещё не оплачен.`
    );
  },
};

/**
 * check_inventory (spec §10, §24, §44) — фактическое наличие товара.
 * Возвращает статус AVAILABLE / LIMITED / OUT_OF_STOCK / UNKNOWN и дату
 * последнего подтверждения продавцом. UNKNOWN никогда не обещается покупателю.
 */
export const checkInventoryTool: ToolDefinition = {
  name: "check_inventory",
  description:
    "Проверить наличие товара: статус, остаток и дату последнего подтверждения продавцом.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    productId: { type: "string", description: "идентификатор товара" },
  }),
  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const productId = typeof args.productId === "string" ? args.productId : undefined;
    if (!productId) return denied("укажите productId товара");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        sku: true,
        status: true,
        inventory: {
          select: {
            quantity: true,
            confirmedBySeller: true,
            confirmedAt: true,
            saleUntil: true,
            autoExtend: true,
          },
        },
      },
    });
    if (!product) return denied("товар не найден");

    const inv = product.inventory;
    if (!inv) {
      return ok(
        { productId: product.id, title: product.title, availability: "UNKNOWN", quantity: null },
        `Наличие товара «${product.title}» не подтверждено продавцом — не могу обещать его доступность.`
      );
    }

    const availability = computeAvailability(
      inv.quantity,
      inv.confirmedBySeller,
      inv.saleUntil ?? null
    );
    const confirmedAt = inv.confirmedAt ? inv.confirmedAt.toISOString() : null;

    const labels: Record<string, string> = {
      AVAILABLE: "в наличии",
      LIMITED: "заканчивается",
      OUT_OF_STOCK: "нет в наличии",
      UNKNOWN: "наличие не подтверждено",
    };

    return ok(
      {
        productId: product.id,
        title: product.title,
        sku: product.sku,
        availability,
        quantity: inv.quantity,
        confirmedAt,
        saleUntil: inv.saleUntil ? inv.saleUntil.toISOString() : null,
        autoExtend: inv.autoExtend,
      },
      `Товар «${product.title}»: ${labels[availability] ?? availability}.` +
        (availability === "UNKNOWN"
          ? " Продавец ещё не подтвердил наличие — не обещаю доставку."
          : ` Остаток: ${inv.quantity} шт.`)
    );
  },
};
