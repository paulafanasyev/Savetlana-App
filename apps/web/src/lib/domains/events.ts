/**
 * Event System (spec §30, §78).
 *
 * Consent-aware domain events feeding recommendations, memory and analytics.
 * Anonymous analytics events do not carry a userId unless the user consented.
 */
import { prisma } from "../prisma";

export type EventType =
  | "product_view"
  | "search"
  | "photo_search"
  | "wishlist_add"
  | "wishlist_remove"
  | "favorite_add"
  | "favorite_remove"
  | "cart_add"
  | "cart_remove"
  | "purchase"
  | "return"
  | "review"
  | "hide_product"
  | "price_alert"
  | "gift_purchase"
  | "relationship_confirmed"
  | "seller_inventory_confirmed"
  | "seller_listing_extended"
  | "delivery_update"
  | "recommendation_feedback"
  | "ai_message";

export interface RecordEventInput {
  type: EventType | string;
  userId?: string;
  productId?: string;
  payload?: Record<string, unknown>;
  anonymous?: boolean;
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        type: input.type,
        userId: input.anonymous ? null : input.userId,
        productId: input.productId,
        payload: JSON.stringify(input.payload ?? {}),
        anonymous: input.anonymous ?? false,
      },
    });
  } catch {
    // Analytics must never break the primary user flow.
  }
}
