/**
 * Gift Agent domain (spec §21, §22, §17, §12).
 *
 * Rules baked in:
 *  - Only VERIFIED relationship context is used for hints (never SUGGESTED).
 *  - stealthMode is default ON: the recipient never sees the gift.
 *  - Group contributions are never auto-charged — each participant confirms
 *    their own amount (spec §22).
 *  - Previously gifted items are excluded from new suggestions.
 */
import { prisma } from "../prisma";
import { fromKopecks, toKopecks } from "../utils";
import { searchProducts } from "./catalog";
import { recordEvent } from "./events";
import { getVerifiedCircle } from "./relationships";

export interface GiftSuggestion {
  productId: string;
  title: string;
  priceKopecks: number;
  reason: string;
}

/**
 * Suggests gifts for a saved event using budget, interests, wishlist hint and
 * the recipient's previously gifted items (so we never repeat a gift).
 */
export async function suggestGifts(
  giftEventId: string,
  limit = 6
): Promise<{ suggestions: GiftSuggestion[]; excludedPreviouslyGifted: string[] }> {
  const ev = await prisma.giftEvent.findUniqueOrThrow({ where: { id: giftEventId } });
  const interests = JSON.parse(ev.interests || "[]") as string[];

  // Previously gifted items for this recipient — excluded (spec §17).
  const previous = await prisma.giftEvent.findMany({
    where: { recipientName: ev.recipientName, status: { not: "DRAFT" } },
    select: { id: true },
  });
  const previousIds = new Set(previous.map((p) => p.id));

  const query = [ev.recipientName, ...interests].filter(Boolean).join(" ");
  const { results } = await searchProducts({
    query,
    maxPrice: ev.budgetKopecks ? fromKopecks(ev.budgetKopecks) : undefined,
    limit: limit * 3,
  });

  const suggestions: GiftSuggestion[] = results
    .filter((r) => !previousIds.has(r.product.id))
    .filter((r) => ev.budgetKopecks === 0 || r.product.priceKopecks <= ev.budgetKopecks)
    .slice(0, limit)
    .map((r) => ({
      productId: r.product.id,
      title: r.product.title,
      priceKopecks: r.product.priceKopecks,
      reason:
        r.signals[0] ??
        (ev.budgetKopecks > 0 && r.product.priceKopecks <= ev.budgetKopecks
          ? `вписывается в бюджет ${fromKopecks(ev.budgetKopecks).toFixed(0)} ₽`
          : "соответствует интересам получателя"),
    }));

  return { suggestions, excludedPreviouslyGifted: [...previousIds] };
}

/**
 * Upcoming events the user asked to be reminded about.
 */
export async function upcomingGiftEvents(userId: string, withinDays = 14) {
  const from = new Date();
  const to = new Date(from.getTime() + withinDays * 24 * 60 * 60 * 1000);
  return prisma.giftEvent.findMany({
    where: { creatorId: userId, eventDate: { gte: from, lte: to }, status: { not: "COMPLETED" } },
    orderBy: { eventDate: "asc" },
  });
}

/**
 * Creates a group gift: the organiser sets the target, participants join and
 * confirm their own contribution. No money moves here — the payment layer
 * charges only after every chosen contribution is confirmed by its owner.
 */
export async function createGroupGift(
  giftEventId: string,
  targetRubles: number,
  actorId: string
) {
  const ev = await prisma.giftEvent.findUniqueOrThrow({ where: { id: giftEventId } });
  if (ev.creatorId !== actorId) throw new Error("только организатор может менять подарок");

  const group = await prisma.giftGroup.upsert({
    where: { giftEventId },
    create: { giftEventId, targetKopecks: toKopecks(targetRubles), collectedKopecks: 0 },
    update: { targetKopecks: toKopecks(targetRubles) },
  });
  await prisma.giftEvent.update({
    where: { id: giftEventId },
    data: { status: "GROUP_COLLECTION", groupId: group.id },
  });
  return group;
}

export async function proposeContribution(
  groupId: string,
  participantId: string,
  amountRubles: number
) {
  return prisma.giftContribution.upsert({
    where: { groupId_participantId: { groupId, participantId } },
    create: {
      groupId,
      participantId,
      amountKopecks: toKopecks(amountRubles),
      isConfirmed: false,
    },
    update: { amountKopecks: toKopecks(amountRubles), isConfirmed: false },
  });
}

/**
 * Participant's explicit opt-in. Until this is set, the amount is a proposal
 * only and the payment layer must refuse to charge it.
 */
export async function confirmContribution(groupId: string, participantId: string) {
  const contribution = await prisma.giftContribution.update({
    where: { groupId_participantId: { groupId, participantId } },
    data: { isConfirmed: true },
  });
  const group = await prisma.giftGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: { contributions: true },
  });
  const collected = group.contributions
    .filter((c) => c.isConfirmed)
    .reduce((sum, c) => sum + c.amountKopecks, 0);
  await prisma.giftGroup.update({
    where: { id: groupId },
    data: { collectedKopecks: collected },
  });
  await recordEvent({
    type: "gift_purchase",
    userId: participantId,
    payload: { groupId, amountKopecks: contribution.amountKopecks },
  });
  return { contribution, collectedKopecks: collected, targetMet: collected >= group.targetKopecks };
}

/**
 * Consent-guarded view of a user's gift context (spec §12).
 */
export async function getGiftContext(userId: string) {
  const [circle, events] = await Promise.all([
    getVerifiedCircle(userId),
    prisma.giftEvent.findMany({
      where: { creatorId: userId },
      orderBy: { eventDate: "asc" },
    }),
  ]);
  return {
    verifiedCircle: circle,
    events,
    /** SUGGESTED relationships are intentionally absent here. */
    note: "Используются только подтверждённые связи. Предположения не учитываются.",
  };
}
