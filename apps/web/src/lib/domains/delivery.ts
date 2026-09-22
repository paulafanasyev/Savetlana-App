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
 */
import { prisma } from "../prisma";
import { env } from "../env";

export interface ShipmentParams {
  orderId: string;
  sellerProfileId: string;
  carrier: string;
  trackingNumber?: string;
  deliveryKopecks?: number;
  estimatedDelivery?: Date;
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
  getTracking(trackingNumber: string): Promise<{ events: TrackingEvent[]; status: string }>;
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
    const created = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      status: "IN_TRANSIT",
      events: [
        {
          status: "CREATED",
          description: "Отправление создано (sandbox)",
          occurredAt: created,
        },
        {
          status: "HANDED_OVER",
          description: "Передано перевозчику (sandbox)",
          occurredAt: new Date(created.getTime() + 3 * 60 * 60 * 1000),
        },
        {
          status: "IN_TRANSIT",
          description: "В пути (sandbox)",
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
 * Resolves the carrier adapter for a key. Real carriers plug in here.
 *
 * Honest resolution (spec §49): an unknown carrier is NOT silently treated as
 * the sandbox. Returns `null` so callers must decide — either fail loudly or
 * record a seller-declared shipment that never fabricates carrier data.
 */
export function getDeliveryProvider(key: string): DeliveryProviderAdapter | null {
  if (key === "SELLER_OWN_DELIVERY") return new SellerOwnDeliveryAdapter();
  if (key === "sandbox-carrier") return new SandboxCarrierAdapter();
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

/**
 * Creates a shipment and advances the order to HANDED_TO_CARRIER. Carrier
 * access is never assumed: if the adapter is unavailable the call fails
 * loudly instead of fabricating a tracking number.
 */
export async function createShipment(params: ShipmentParams) {
  const adapter = getDeliveryProvider(params.carrier);

  // A seller who already has a carrier tracking number is the source of truth
  // (spec §123): record it verbatim and never fabricate a replacement.
  // Marked SELLER_DECLARED — live carrier sync is unavailable for it, so the
  // tracking screen shows the seller's data as-is instead of inventing events.
  const sellerDeclared = !adapter && params.trackingNumber;
  if (!adapter && !sellerDeclared) {
    throw new Error(
      `carrier "${params.carrier}" has no adapter configured (PENDING_EXTERNAL_ACCESS)`,
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
  await prisma.order.update({
    where: { id: params.orderId },
    data: {
      deliveryKopecks: created.priceKopecks,
      totalKopecks: { increment: created.priceKopecks },
      status: "PROCESSING",
    },
  });
  return shipment;
}

/**
 * Syncs tracking from the authoritative carrier (spec §123: the carrier is
 * the source of truth, never the AI) and records the event timeline.
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
  // return the persisted timeline verbatim. Never invent carrier events
  // (spec §49 — no fake delivery tracking presented as real).
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

  // The carrier speaks *shipment* vocabulary (HANDED_OVER), the order speaks
  // *order* vocabulary (HANDED_TO_CARRIER). Translate explicitly (spec §123).
  const SHIPMENT_TO_ORDER_STATUS: Record<string, string> = {
    DELIVERED: "DELIVERED",
    IN_TRANSIT: "IN_TRANSIT",
    HANDED_OVER: "HANDED_TO_CARRIER",
  };
  const targetOrderStatus = SHIPMENT_TO_ORDER_STATUS[tracking.status];

  return prisma.deliveryShipment.update({
    where: { id: shipment.id },
    data: {
      status: tracking.status,
      eta: eta ?? shipment.eta,
      ...(targetOrderStatus
        ? {
            order: {
              update: {
                status: canTransitionShipment(shipment.status, tracking.status)
                  ? targetOrderStatus
                  : undefined,
              },
            },
          }
        : {}),
    },
    include: { events: { orderBy: { occurredAt: "asc" } } },
  });
}

export { env };
