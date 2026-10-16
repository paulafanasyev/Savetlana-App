import { PAYOUT_READY_ORDER_STATUSES } from "../safe-deal";

/**
 * Shared Prisma filter: seller money is reservable only after the buyer accepted
 * the order (safe deal). A delivered but not yet accepted order keeps the money
 * on the platform account.
 */
export const deliveredSettlementWhere = {
  order: { status: { in: [...PAYOUT_READY_ORDER_STATUSES] } },
} as const;
