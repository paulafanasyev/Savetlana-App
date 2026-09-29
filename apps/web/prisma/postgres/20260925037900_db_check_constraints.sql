-- P0-20: DB-level CHECK constraints (PostgreSQL production target).
--
-- PRISMA VERSION NOTE: the `@@check` schema attribute requires the
-- `checkConstraints` preview feature, which is not present in the pinned
-- Prisma 5.22. The constraints are therefore declared here, in SQL, and are
-- applied by `prisma migrate deploy` on PostgreSQL. SQLite (the dev DB in this
-- container) cannot ALTER TABLE ADD CONSTRAINT at all, so this migration is
-- PostgreSQL-only and is skipped on SQLite by the deployment script.
--
-- Why: statuses were bare TEXT columns whose canonical vocabulary lived only
-- in TypeScript (src/lib/db/enums.ts). A bug — or any code path bypassing the
-- state machines — could write an illegal value straight into the DB and the
-- platform would then happily report it as fact (spec §124 CONSISTENCY).
-- These constraints make the database the last line of defence.

-- Orders: status vocabulary + non-negative money
ALTER TABLE "Order" ADD CONSTRAINT order_status_check CHECK (status IN ('CREATED', 'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'PROCESSING', 'READY', 'HANDED_TO_CARRIER', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNING', 'REFUNDED', 'DISPUTED'));
ALTER TABLE "Order" ADD CONSTRAINT order_money_check CHECK ("subtotalKopecks" >= 0 AND "deliveryKopecks" >= 0 AND "platformFeeKopecks" >= 0 AND "paymentFeeKopecks" >= 0 AND "totalKopecks" >= 0);

-- Payments: status vocabulary + non-negative amounts
ALTER TABLE "Payment" ADD CONSTRAINT payment_status_check CHECK (status IN ('PENDING', 'AUTHORIZED', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'));
ALTER TABLE "Payment" ADD CONSTRAINT payment_money_check CHECK ("amountKopecks" >= 0 AND "feeKopecks" >= 0);

-- Refunds
ALTER TABLE "Refund" ADD CONSTRAINT refund_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'));
ALTER TABLE "Refund" ADD CONSTRAINT refund_money_check CHECK ("amountKopecks" >= 0);

-- Payouts
ALTER TABLE "Payout" ADD CONSTRAINT payout_status_check CHECK (status IN ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELLED'));
ALTER TABLE "Payout" ADD CONSTRAINT payout_money_check CHECK ("amountKopecks" >= 0);

-- Seller verification gates (P0-4)
ALTER TABLE "SellerProfile" ADD CONSTRAINT seller_identity_check CHECK ("identityStatus" IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'));
ALTER TABLE "SellerProfile" ADD CONSTRAINT seller_business_check CHECK ("businessStatus" IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'));
ALTER TABLE "SellerProfile" ADD CONSTRAINT seller_npd_check CHECK ("npdStatus" IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'));
ALTER TABLE "SellerProfile" ADD CONSTRAINT seller_type_check CHECK ("sellerType" IN ('INDIVIDUAL', 'SELF_EMPLOYED', 'IP', 'COMPANY'));

-- Inventory: never negative + availability vocabulary (P0-6 overselling)
ALTER TABLE "Inventory" ADD CONSTRAINT inventory_qty_check CHECK (quantity >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT inventory_availability_check CHECK (availability IN ('AVAILABLE', 'LIMITED', 'OUT_OF_STOCK', 'PREORDER', 'MADE_TO_ORDER', 'UNKNOWN'));

-- Listings: a live listing must have been published
ALTER TABLE "Listing" ADD CONSTRAINT listing_live_check CHECK ("isLive" = false OR "publishedAt" IS NOT NULL);
