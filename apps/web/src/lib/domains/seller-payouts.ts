/**
 * Выплата продавцу только за доставленные заказы. Резерв и outbox как в payments.ts
 * (вызов банка вне транзакции, идемпотентность по ключу), но фильтр по статусу
 * заказа стоит прямо в резерве, а не только в маршруте.
 */
import { prisma } from "../prisma";
import { getPayoutProvider, processPayoutOutbox } from "./payments";

export const DELIVERED_ORDER_STATUSES = ["DELIVERED", "COMPLETED"];

export const readySettlementWhere = (sellerId: string) => ({
  sellerId,
  status: "PENDING",
  payoutId: null,
  order: { status: { in: DELIVERED_ORDER_STATUSES } },
});

export async function availablePayoutKopecks(sellerId: string): Promise<number> {
  const sum = await prisma.settlement.aggregate({ where: readySettlementWhere(sellerId), _sum: { payoutKopecks: true } });
  return sum._sum.payoutKopecks ?? 0;
}

export async function payoutDeliveredSettlements(input: {
  sellerId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<{ payoutId: string | null; amountKopecks: number; status: string; sandbox: boolean }> {
  const reserved = await prisma.$transaction(async (tx) => {
    const existing = await tx.payout.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { payoutId: existing.id };
    const ready = await tx.settlement.findMany({ where: readySettlementWhere(input.sellerId), orderBy: { createdAt: "asc" } });
    if (ready.length === 0) return null;
    const total = ready.reduce((sum, s) => sum + s.payoutKopecks, 0);
    const provider = getPayoutProvider();
    const payout = await tx.payout.create({
      data: {
        sellerId: input.sellerId,
        provider: provider.key,
        idempotencyKey: input.idempotencyKey,
        amountKopecks: total,
        status: "IN_PROGRESS",
        settlements: { connect: ready.map((s) => ({ id: s.id })) },
      },
    });
    await tx.settlement.updateMany({ where: { id: { in: ready.map((s) => s.id) } }, data: { status: "AVAILABLE", payoutId: payout.id } });
    await tx.outboxMessage.create({
      data: {
        aggregate: "payout",
        aggregateId: payout.id,
        type: "PAYOUT_REQUEST",
        payload: JSON.stringify({
          sellerId: input.sellerId,
          amountKopecks: total,
          settlementIds: ready.map((s) => s.id),
          idempotencyKey: input.idempotencyKey,
          providerKey: provider.key,
          sandbox: provider.sandbox,
        }),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: "SELLER",
        action: "PAYOUT_REQUESTED",
        targetType: "Payout",
        targetId: payout.id,
        before: String(null),
        after: JSON.stringify({ amountKopecks: total, provider: provider.key, sandbox: provider.sandbox }),
      },
    });
    return { payoutId: payout.id };
  });
  if (!reserved) return { payoutId: null, amountKopecks: 0, status: "NOTHING_TO_PAYOUT", sandbox: false };
  await processPayoutOutbox({ payoutId: reserved.payoutId });
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: reserved.payoutId } });
  return { payoutId: payout.id, amountKopecks: payout.amountKopecks, status: payout.status, sandbox: payout.provider === "sandbox-payout" };
}
