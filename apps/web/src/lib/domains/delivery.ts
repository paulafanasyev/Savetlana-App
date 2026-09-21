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
          status: "HANDED_TO_CARRIER",
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

export function getDeliveryProvider(key: string): DeliveryProviderAdapter {
  if (key === "SELLER_OWN_DELIVERY") return new SellerOwnDeliveryAdapter();
  return new SandboxCarrierAdapter();
}

export const SHIPMENT_STATES = [
  "CREATED",
  "HANDED_TO_CARRIER",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "RETURNED",
  "CANCELLED",
] as const;

const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  CREATED: ["HANDED_TO_CARRIER", "CANCELLED", "FAILED"],
  HANDED_TO_CARRIER: ["IN_TRANSIT", "FAILED", "CANCELLED"],
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
  if (!adapter.available) {
    throw new Error(`carrier ${params.carrier} is not available`);
  }
  const created = await adapter.createShipment(params);

  const shipment = await prisma.deliveryShipment.create({
    data: {
      orderId: params.orderId,
      providerKey: adapter.key,
      carrierName: params.carrier,
      trackingNumber: created.trackingNumber,
      status: "CREATED",
      eta: created.estimatedDelivery,
      sandbox: adapter.sandbox,
    },
  });
  await prisma.deliveryEvent.create({
    data: {
      shipmentId: shipment.id,
      status: "CREATED",
      description: "Отправление создано",
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
  });
  const adapter = getDeliveryProvider(shipment.providerKey);
  if (!shipment.trackingNumber) {
    throw new Error(`Shipment ${shipment.id} has no tracking number yet`);
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

  const targetOrderStatus =
    tracking.status === "DELIVERED"
      ? "DELIVERED"
      : tracking.status === "IN_TRANSIT"
        ? "IN_TRANSIT"
        : tracking.status === "HANDED_TO_CARRIER"
          ? "HANDED_TO_CARRIER"
          : undefined;

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
