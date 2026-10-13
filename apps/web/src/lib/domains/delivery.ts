/**
 * Delivery Provider abstraction (spec §23, §24, §33, §34).
 *
 *   createShipment | cancelShipment | getTracking | getStatus
 *   getETA | calculatePrice | getPickupPoints
 *
 * Multiple carriers plug in as adapters. `SELLER_OWN_DELIVERY` is a first-class
 * provider type — on day one the platform owns no warehouses and the seller
 * fulfils from their own stock (spec §36).
 *
 * No carrier integration is claimed unless a real adapter is configured
 * (spec §49, §58). The sandbox carrier is explicitly marked.
 *
 * Money rule: the delivery price is chosen and paid at checkout. Creating a
 * shipment after payment never changes what the buyer owes.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { CdekCarrierAdapter } from "./carriers/cdek";
import { canTransition } from "./orders";

export interface ShipmentParams {
  orderId: string;
  sellerProfileId: string;
  carrier: string;
  trackingNumber?: string;
  deliveryKopecks?: number;
  estimatedDelivery?: Date;
  /** СДЭК через площадку: код пункта, куда продавец сдаст посылку. */
  fromPointCode?: string;
  /** Вес посылки в граммах, если продавец его указал. */
  weightGrams?: number;
}

export interface TrackingEvent {
  status: string;
  description: string;
  occurredAt: Date;
}

export interface DeliveryProviderAdapter {
  readonly key: string;
  readonly sandbox: boolean;
  readonly available: boolean;
  createShipment(params: ShipmentParams): Promise<{
    trackingNumber: string;
    estimatedDelivery?: Date;
    priceKopecks: number;
  }>;
  cancelShipment(trackingNumber: string): Promise<{ ok: boolean }>;
  /** externalNumber: номер, который перевозчик выдал после регистрации (его видит покупатель). */
  getTracking(trackingNumber: string): Promise<{ events: TrackingEvent[]; status: string; externalNumber?: string }>;
  getEta(trackingNumber: string): Promise<Date | null>;
  calculatePrice(params: { weightGrams?: number; city?: string }): Promise<number>;
}

/**
 * Sandbox carrier. Generates deterministic tracking numbers and statuses so
 * the tracking screen and state machine are fully testable offline. Every
 * shipment it creates is recorded with sandbox: true.
 */
export class SandboxCarrierAdapter implements DeliveryProviderAdapter {
  readonly key = "sandbox-carrier";
  readonly sandbox = true;
  readonly available = true;

  async createShipment(params: ShipmentParams) {
    const seq = Math.floor(Math.random() * 1e6)
      .toString()
      .padStart(6, "0");
    return {
      trackingNumber: `SB${params.orderId.slice(-6).toUpperCase()}${seq}`,
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      priceKopecks: 35000,
    };
  }
  async cancelShipment() {
    return { ok: true };
  }
  async getTracking(trackingNumber: string) {
    void trackingNumber;
    const created = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      status: "IN_TRANSIT",
      events: [
        {
          status: "CREATED",
          description: "Отправление создано (тестовая доставка)",
          occurredAt: created,
        },
        {
          status: "HANDED_OVER",
          description: "Передано перевозчику (тестовая доставка)",
          occurredAt: new Date(created.getTime() + 3 * 60 * 60 * 1000),
        },
        {
          status: "IN_TRANSIT",
          description: "В пути (тестовая доставка)",
          occurredAt: new Date(),
        },
      ],
    };
  }
  async getEta() {
    return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  }
  async calculatePrice() {
    return 35000;
  }
}

/** Seller's own delivery (spec §35) — seller states zone, price, terms. */
export class SellerOwnDeliveryAdapter implements DeliveryProviderAdapter {
  readonly key = "SELLER_OWN_DELIVERY";
  readonly sandbox = false;
  readonly available = true;

  async createShipment(params: ShipmentParams) {
    return {
      trackingNumber: `SELLER-${params.orderId.slice(-8).toUpperCase()}`,
      estimatedDelivery: params.estimatedDelivery ?? new Date(Date.now() + 2 * 864e5),
      priceKopecks: params.deliveryKopecks ?? 0,
    };
  }
  async cancelShipment() {
    return { ok: true };
  }
  async getTracking() {
    return {
      status: "PROCESSING",
      events: [
        {
          status: "CREATED",
          description: "Доставка выполняется продавцом самостоятельно",
          occurredAt: new Date(),
        },
      ],
    };
  }
  async getEta() {
    return new Date(Date.now() + 2 * 864e5);
  }
  async calculatePrice() {
    return 0;
  }
}

/**
 * Resolves the carrier adapter for a key. An unknown carrier is NOT silently
 * treated as the sandbox (spec §49): returns `null` so callers must decide.
 */
export function getDeliveryProvider(key: string): DeliveryProviderAdapter | null {
  if (key === "SELLER_OWN_DELIVERY") return new SellerOwnDeliveryAdapter();
  if (key === "sandbox-carrier") return new SandboxCarrierAdapter();
  // Real carriers (audit §10). `available === false` makes createShipment
  // fail loudly with PENDING_EXTERNAL_ACCESS rather than fabricate a number.
  const cdek = new CdekCarrierAdapter();
  if (key === "cdek" || key === "CDEK") return cdek;
  return null;
}

/** Provider key for a shipment whose tracking number came from the seller. */
export const SELLER_DECLARED_KEY = "SELLER_DECLARED";

export const SHIPMENT_STATES = [
  "CREATED",
  "HANDED_OVER",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "RETURNED",
  "CANCELLED",
] as const;

const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  CREATED: ["HANDED_OVER", "CANCELLED", "FAILED"],
  HANDED_OVER: ["IN_TRANSIT", "FAILED", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "FAILED", "RETURNED"],
  DELIVERED: [],
  FAILED: ["RETURNED", "CREATED"],
  RETURNED: [],
  CANCELLED: [],
};

export function canTransitionShipment(from: string, to: string): boolean {
  return (SHIPMENT_TRANSITIONS[from] ?? []).includes(to);
}

/** Нормальный путь отправления и соответствующие статусы заказа. */
const SHIPMENT_PATH = ["CREATED", "HANDED_OVER", "IN_TRANSIT", "DELIVERED"];
const ORDER_PATH = ["PROCESSING", "HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED"];
const SHIPMENT_TO_ORDER_STATUS: Record<string, string> = {
  HANDED_OVER: "HANDED_TO_CARRIER",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
};

/**
 * Куда можно продвинуть отправление по данным перевозчика. Перевозчик может
 * сообщить сразу «в пути», минуя «передано»: движение вперёд по нормальному пути
 * разрешено, назад — никогда.
 */
export function nextShipmentStatus(current: string, reported: string): string {
  const from = SHIPMENT_PATH.indexOf(current);
  const to = SHIPMENT_PATH.indexOf(reported);
  if (from >= 0 && to > from) return reported;
  if (canTransitionShipment(current, reported)) return reported;
  return current;
}

/** Продвигает заказ по шагам машины состояний до статуса, соответствующего отправлению. */
export function orderStepsForShipment(orderStatus: string, shipmentStatus: string): string[] {
  const goal = SHIPMENT_TO_ORDER_STATUS[shipmentStatus];
  if (!goal) return [];
  const goalIndex = ORDER_PATH.indexOf(goal);
  let current = orderStatus;
  let index = current === "READY" ? 0 : ORDER_PATH.indexOf(current);
  const steps: string[] = [];
  while (index >= 0 && index < goalIndex && canTransition(current, ORDER_PATH[index + 1])) {
    current = ORDER_PATH[index + 1];
    steps.push(current);
    index += 1;
  }
  return steps;
}

/**
 * Creates a shipment and moves a confirmed order into fulfilment. Carrier
 * access is never assumed: if the adapter is unavailable the call fails
 * loudly instead of fabricating a tracking number. The paid total is never
 * changed here: delivery was chosen and paid at checkout.
 */
export async function createShipment(params: ShipmentParams) {
  const resolved = getDeliveryProvider(params.carrier);

  // A seller who already has a carrier tracking number is the source of truth
  // (spec §123): record it verbatim and never fabricate a replacement.
  // Если продавец сам сдал посылку и ввёл трек-номер, заявку у перевозчика не
  // создаём повторно, даже когда перевозчик подключён: записываем его номер.
  const declaredByChoice = Boolean(params.trackingNumber) && resolved?.key === "cdek";
  const adapter = resolved && resolved.available && !declaredByChoice ? resolved : null;
  const sellerDeclared = !adapter && Boolean(params.trackingNumber);
  if (!adapter && !sellerDeclared) {
    throw new Error(
      resolved
        ? `carrier "${params.carrier}" is not configured: ${(resolved as DeliveryProviderAdapter & { requiredCredential?: string }).requiredCredential ?? "missing credentials"} (PENDING_EXTERNAL_ACCESS)`
        : `carrier "${params.carrier}" has no adapter configured (PENDING_EXTERNAL_ACCESS)`,
    );
  }

  const created = adapter
    ? await adapter.createShipment(params)
    : {
        trackingNumber: params.trackingNumber as string,
        estimatedDelivery: params.estimatedDelivery,
        priceKopecks: params.deliveryKopecks ?? 0,
      };

  const shipment = await prisma.deliveryShipment.create({
    data: {
      orderId: params.orderId,
      providerKey: adapter ? adapter.key : SELLER_DECLARED_KEY,
      carrierName: params.carrier,
      trackingNumber: created.trackingNumber,
      status: "CREATED",
      eta: created.estimatedDelivery,
      sandbox: adapter ? adapter.sandbox : false,
    },
  });
  await prisma.deliveryEvent.create({
    data: {
      shipmentId: shipment.id,
      status: "CREATED",
      description: sellerDeclared
        ? "Отправление зарегистрировано продавцом (трек-номер указан продавцом, синхронизация с перевозчиком недоступна)"
        : "Отправление создано",
    },
  });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: params.orderId }, select: { status: true } });
  if (canTransition(order.status, "PROCESSING")) {
    await prisma.order.update({ where: { id: params.orderId }, data: { status: "PROCESSING" } });
  }
  return shipment;
}

/**
 * Syncs tracking from the authoritative carrier (spec §123: the carrier is
 * the source of truth, never the AI) and records the event timeline. Order
 * status follows the shipment one step at a time through the order state
 * machine, so a carrier that skips a status cannot strand the order.
 */
export async function syncTracking(shipmentId: string) {
  const shipment = await prisma.deliveryShipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { events: { orderBy: { occurredAt: "asc" } } },
  });
  if (!shipment.trackingNumber) {
    throw new Error(`Shipment ${shipment.id} has no tracking number yet`);
  }
  const adapter = getDeliveryProvider(shipment.providerKey);

  // No real carrier adapter (seller-declared or PENDING_EXTERNAL_ACCESS):
  // return the persisted timeline verbatim. Never invent carrier events.
  if (!adapter) {
    return shipment;
  }

  const tracking = await adapter.getTracking(shipment.trackingNumber);
  const eta = await adapter.getEta(shipment.trackingNumber);

  for (const ev of tracking.events) {
    await prisma.deliveryEvent.upsert({
      where: {
        shipmentId_status_occurredAt: {
          shipmentId: shipment.id,
          status: ev.status,
          occurredAt: ev.occurredAt,
        },
      },
      create: {
        shipmentId: shipment.id,
        status: ev.status,
        description: ev.description,
        occurredAt: ev.occurredAt,
      },
      update: {},
    });
  }

  const newShipmentStatus = nextShipmentStatus(shipment.status, tracking.status);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: shipment.orderId }, select: { status: true } });
  const steps = orderStepsForShipment(order.status, newShipmentStatus);
  if (steps.length) {
    await prisma.$transaction([
      prisma.order.update({ where: { id: shipment.orderId }, data: { status: steps[steps.length - 1] } }),
      ...steps.map((to, i) =>
        prisma.orderHistory.create({
          data: { orderId: shipment.orderId, fromStatus: i === 0 ? order.status : steps[i - 1], toStatus: to, reason: "carrier tracking" },
        }),
      ),
    ]);
  }

  // После регистрации СДЭК выдаёт свой номер: показываем покупателю его, а не номер заявки.
  const externalNumber = tracking.externalNumber && tracking.externalNumber !== shipment.trackingNumber ? tracking.externalNumber : undefined;

  return prisma.deliveryShipment.update({
    where: { id: shipment.id },
    data: { status: newShipmentStatus, eta: eta ?? shipment.eta, ...(externalNumber ? { trackingNumber: externalNumber } : {}) },
    include: { events: { orderBy: { occurredAt: "asc" } } },
  });
}

export { env };
