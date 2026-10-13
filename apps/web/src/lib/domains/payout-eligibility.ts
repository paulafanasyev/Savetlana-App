/** Shared Prisma filter: seller money is reservable only after delivery. */
export const deliveredSettlementWhere = {
  order: { status: { in: ["DELIVERED", "COMPLETED"] } },
} as const;
