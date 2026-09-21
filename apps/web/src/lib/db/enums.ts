// AUTO-GENERATED canonical enum definitions (mirrors prisma/schema.prisma).
//
// SQLite has no enum type, so these values are stored as TEXT. This module is
// the single source of truth and validates every read/write. On PostgreSQL the
// columns can be promoted to native enums via a migration; application code
// does not change because it already speaks these string values.

export const UserRole_VALUES = ["BUYER", "SELLER", "ADMIN"] as const;
export type UserRole = (typeof UserRole_VALUES)[number];

export const SellerType_VALUES = ["INDIVIDUAL", "SELF_EMPLOYED", "IP", "COMPANY"] as const;
export type SellerType = (typeof SellerType_VALUES)[number];

export const VerificationStatus_VALUES = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED", "REVOKED"] as const;
export type VerificationStatus = (typeof VerificationStatus_VALUES)[number];

export const ProductStatus_VALUES = ["DRAFT", "PENDING_SELLER_APPROVAL", "ACTIVE", "HIDDEN", "ARCHIVED"] as const;
export type ProductStatus = (typeof ProductStatus_VALUES)[number];

export const AvailabilityStatus_VALUES = ["AVAILABLE", "LIMITED", "OUT_OF_STOCK", "PREORDER", "MADE_TO_ORDER", "UNKNOWN"] as const;
export type AvailabilityStatus = (typeof AvailabilityStatus_VALUES)[number];

export const OrderStatus_VALUES = ["CREATED", "PAYMENT_PENDING", "PAID", "CONFIRMED", "PROCESSING", "READY", "HANDED_TO_CARRIER", "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELLED", "RETURN_REQUESTED", "RETURNING", "REFUNDED", "DISPUTED"] as const;
export type OrderStatus = (typeof OrderStatus_VALUES)[number];

export const PaymentStatus_VALUES = ["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
export type PaymentStatus = (typeof PaymentStatus_VALUES)[number];

export const SettlementStatus_VALUES = ["PENDING", "AVAILABLE", "PAID", "ADJUSTED"] as const;
export type SettlementStatus = (typeof SettlementStatus_VALUES)[number];

export const PayoutStatus_VALUES = ["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED"] as const;
export type PayoutStatus = (typeof PayoutStatus_VALUES)[number];

export const ShipmentStatus_VALUES = ["CREATED", "HANDED_OVER", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED"] as const;
export type ShipmentStatus = (typeof ShipmentStatus_VALUES)[number];

export const RelationshipType_VALUES = ["PARENT", "CHILD", "SPOUSE", "SIBLING", "RELATIVE", "FRIEND", "COLLEAGUE", "BUSINESS_CONTACT"] as const;
export type RelationshipType = (typeof RelationshipType_VALUES)[number];

export const RelationshipStatus_VALUES = ["SUGGESTED", "DECLARED", "PENDING_CONFIRMATION", "VERIFIED", "REJECTED"] as const;
export type RelationshipStatus = (typeof RelationshipStatus_VALUES)[number];

export const DocumentStatus_VALUES = ["UPLOADED", "PROCESSING", "VERIFIED", "REJECTED", "EXPIRED", "PENDING_REVIEW"] as const;
export type DocumentStatus = (typeof DocumentStatus_VALUES)[number];

export const RiskLevel_VALUES = ["LOW", "MEDIUM", "HIGH", "REVIEW", "BLOCKED"] as const;
export type RiskLevel = (typeof RiskLevel_VALUES)[number];

export const MemoryType_VALUES = ["FACT", "INFERENCE", "PREFERENCE", "TEMPORARY_CONTEXT"] as const;
export type MemoryType = (typeof MemoryType_VALUES)[number];

export const GiftStatus_VALUES = ["DRAFT", "ACTIVE", "FUNDED", "ORDERED", "DELIVERED", "CANCELLED"] as const;
export type GiftStatus = (typeof GiftStatus_VALUES)[number];

export const ListingHistoryAction_VALUES = ["CREATED", "PRICE_CHANGED", "PHOTOS_CHANGED", "DESCRIPTION_CHANGED", "ATTRIBUTES_CHANGED", "INVENTORY_CHANGED", "AVAILABILITY_CONFIRMED", "SALE_EXTENDED", "PUBLISHED", "HIDDEN", "ARCHIVED", "AI_DRAFT_CREATED", "SELLER_APPROVED_DRAFT"] as const;
export type ListingHistoryAction = (typeof ListingHistoryAction_VALUES)[number];

export const EventType_VALUES = ["PRODUCT_VIEW", "SEARCH", "PHOTO_SEARCH", "WISHLIST_ADD", "WISHLIST_REMOVE", "FAVORITE_ADD", "FAVORITE_REMOVE", "CART_ADD", "CART_REMOVE", "PURCHASE", "RETURN", "REVIEW", "HIDE_PRODUCT", "PRICE_ALERT", "GIFT_PURCHASE", "RELATIONSHIP_CONFIRMED", "SELLER_INVENTORY_CONFIRMED", "SELLER_LISTING_EXTENDED", "DELIVERY_UPDATE", "AI_FEEDBACK"] as const;
export type EventType = (typeof EventType_VALUES)[number];

export const ToolPermission_VALUES = ["READ_PRODUCTS", "READ_ORDERS", "READ_REVIEWS", "READ_TRACKING", "READ_ANALYTICS", "READ_MEMORY", "CREATE_PRODUCT_DRAFT", "EDIT_PRODUCT_DRAFT", "PUBLISH_PRODUCT", "CHANGE_PRICE", "CONFIRM_INVENTORY", "EXTEND_LISTING", "CREATE_SHIPMENT", "REQUEST_PAYOUT", "CREATE_ORDER", "CANCEL_ORDER", "REQUEST_RETURN", "WRITE_MEMORY", "SEND_NOTIFICATION", "CREATE_GIFT", "MANAGE_RELATIONSHIPS"] as const;
export type ToolPermission = (typeof ToolPermission_VALUES)[number];

export const ToolRiskLevel_VALUES = ["READ", "LOW_RISK_WRITE", "HIGH_RISK_WRITE", "FINANCIAL", "ACCOUNT_SECURITY"] as const;
export type ToolRiskLevel = (typeof ToolRiskLevel_VALUES)[number];

export const IntegrationProvider_VALUES = ["VK", "ESIA", "ALIPAY"] as const;
export type IntegrationProvider = (typeof IntegrationProvider_VALUES)[number];

export const ConsentType_VALUES = ["PERSONAL_DATA", "SOCIAL_INTEGRATION", "MARKETING", "AI_PERSONALIZATION", "AI_MEMORY", "ANALYTICS", "COOKIES_STRICTLY_NECESSARY", "COOKIES_ANALYTICS", "COOKIES_PERSONALIZATION", "COOKIES_ADVERTISING"] as const;
export type ConsentType = (typeof ConsentType_VALUES)[number];

export const DisputeStatus_VALUES = ["OPEN", "EVIDENCE_COLLECTION", "RESOLVED_BUYER", "RESOLVED_SELLER", "ESCALATED_HUMAN", "CLOSED"] as const;
export type DisputeStatus = (typeof DisputeStatus_VALUES)[number];

export const DisputeReason_VALUES = ["ITEM_NOT_RECEIVED", "ITEM_NOT_AS_DESCRIBED", "ITEM_DAMAGED", "PAYMENT_DISPUTE", "RETURN_DISPUTE", "DELIVERY_DISPUTE"] as const;
export type DisputeReason = (typeof DisputeReason_VALUES)[number];

export const EvidenceVerification_VALUES = ["VERIFIED", "NOT_PROVEN", "PENDING"] as const;
export type EvidenceVerification = (typeof EvidenceVerification_VALUES)[number];

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

type EnumRecord = Record<string, readonly string[]>;

const ALL_ENUMS: EnumRecord = {
  UserRole: UserRole_VALUES,
  SellerType: SellerType_VALUES,
  VerificationStatus: VerificationStatus_VALUES,
  ProductStatus: ProductStatus_VALUES,
  AvailabilityStatus: AvailabilityStatus_VALUES,
  OrderStatus: OrderStatus_VALUES,
  PaymentStatus: PaymentStatus_VALUES,
  SettlementStatus: SettlementStatus_VALUES,
  PayoutStatus: PayoutStatus_VALUES,
  ShipmentStatus: ShipmentStatus_VALUES,
  RelationshipType: RelationshipType_VALUES,
  RelationshipStatus: RelationshipStatus_VALUES,
  DocumentStatus: DocumentStatus_VALUES,
  RiskLevel: RiskLevel_VALUES,
  MemoryType: MemoryType_VALUES,
  GiftStatus: GiftStatus_VALUES,
  ListingHistoryAction: ListingHistoryAction_VALUES,
  EventType: EventType_VALUES,
  ToolPermission: ToolPermission_VALUES,
  ToolRiskLevel: ToolRiskLevel_VALUES,
  IntegrationProvider: IntegrationProvider_VALUES,
  ConsentType: ConsentType_VALUES,
  DisputeStatus: DisputeStatus_VALUES,
  DisputeReason: DisputeReason_VALUES,
  EvidenceVerification: EvidenceVerification_VALUES,
};

/** Returns true when the value is a legal member of the named enum. */
export function isValidEnum(enumName: string, value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const allowed = ALL_ENUMS[enumName];
  return Boolean(allowed) && (allowed as readonly string[]).includes(value);
}

/** Parses a stored value, returning the fallback when the DB contains junk. */
export function parseEnum<T extends string>(
  enumName: string,
  value: string | null | undefined,
  fallback: T
): T {
  if (isValidEnum(enumName, value)) return value as T;
  return fallback;
}

/** Throws on invalid values — use at write boundaries. */
export function assertEnum(enumName: string, value: string): void {
  if (!isValidEnum(enumName, value)) {
    throw new Error(`Invalid ${enumName}: ${String(value)}`);
  }
}
