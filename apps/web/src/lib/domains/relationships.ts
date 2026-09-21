/**
 * Relationship Graph (spec §16, §18, §157).
 *
 * CONSENT BY CONSTRUCTION. A relationship is never a fact until both people
 * confirm it. AI suggestions stay SUGGESTED with a confidence score and an
 * explicit source; the UI may surface them but must label them as
 * предположение, not fact.
 *
 * Statuses: SUGGESTED → DECLARED → PENDING_CONFIRMATION → VERIFIED | REJECTED
 */
import { prisma } from "../prisma";
import { generateToken } from "../utils";
import { audit } from "./audit";
import { recordEvent } from "./events";

export const RELATIONSHIP_TYPES = [
  "parent",
  "child",
  "spouse",
  "sibling",
  "relative",
  "friend",
  "colleague",
  "business_contact",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type RelationshipStatus =
  | "SUGGESTED"
  | "DECLARED"
  | "PENDING_CONFIRMATION"
  | "VERIFIED"
  | "REJECTED";

export interface RelationshipInfo {
  id: string;
  fromUserId: string;
  toUserId: string;
  type: string;
  status: RelationshipStatus;
  source: string;
  confidence: number | null;
  note: string | null;
  /** True only when status === VERIFIED — the only case "связь — факт". */
  isVerifiedFact: boolean;
}

export function toInfo(r: {
  id: string;
  fromUserId: string;
  toUserId: string;
  type: string;
  status: string;
  source: string;
  confidence: number | null;
  note: string | null;
}): RelationshipInfo {
  return {
    ...r,
    status: r.status as RelationshipStatus,
    isVerifiedFact: r.status === "VERIFIED",
  };
}

/**
 * One user declares a relationship. It becomes PENDING_CONFIRMATION and the
 * other side receives a confirmation request with a token.
 */
export async function declareRelationship(
  fromUserId: string,
  toUserId: string,
  type: string,
  note?: string
): Promise<{ relationship: RelationshipInfo; confirmationId: string; alreadyVerified: boolean }> {
  if (fromUserId === toUserId) throw new Error("нельзя указать связь с самим собой");
  if (!RELATIONSHIP_TYPES.includes(type as RelationshipType)) {
    throw new Error(`недопустимый тип связи: ${type}`);
  }

  // Idempotent: an existing confirmed mirror link is already a fact.
  const mirror = await prisma.relationship.findFirst({
    where: {
      OR: [
        { fromUserId: toUserId, toUserId: fromUserId, type },
        { fromUserId, toUserId, type },
      ],
    },
    include: { confirmations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (mirror && mirror.status === "VERIFIED") {
    return {
      relationship: toInfo(mirror),
      confirmationId: mirror.confirmations[0]?.id ?? "",
      alreadyVerified: true,
    };
  }

  const rel = await prisma.relationship.upsert({
    where: {
      fromUserId_toUserId_type: { fromUserId, toUserId, type },
    },
    create: {
      fromUserId,
      toUserId,
      type,
      status: "PENDING_CONFIRMATION",
      source: "manual",
      note,
    },
    update: {
      status: "PENDING_CONFIRMATION",
      source: "manual",
      note,
    },
  });

  const confirmation = await prisma.relationshipConfirmation.create({
    data: {
      relationshipId: rel.id,
      requestedById: fromUserId,
      token: generateToken(24),
    },
  });

  await prisma.notification.create({
    data: {
      userId: toUserId,
      kind: "relationship_request",
      title: "Подтверждение связи",
      body: `Пользователь хочет добавить вас в свой круг контактов как «${type}». Подтвердите, если это так.`,
      url: `/profile/relationships?confirm=${confirmation.token}`,
    },
  });

  await audit({
    actorId: fromUserId,
    actorRole: "buyer",
    action: "relationship_declared",
    targetType: "Relationship",
    targetId: rel.id,
    after: { type, status: "PENDING_CONFIRMATION" },
  });

  return {
    relationship: toInfo(rel),
    confirmationId: confirmation.id,
    alreadyVerified: false,
  };
}

/**
 * The OTHER side decides. Only the target user may confirm their own
 * relationship to someone — no one can verify a link about another person
 * on their behalf.
 */
export async function answerRelationshipConfirmation(
  token: string,
  decidingUserId: string,
  accept: boolean
): Promise<RelationshipInfo> {
  const confirmation = await prisma.relationshipConfirmation.findUnique({
    where: { token },
    include: { relationship: true },
  });
  if (!confirmation) throw new Error("запрос подтверждения не найден или устарел");
  if (confirmation.decision) throw new Error("по этому запросу уже принято решение");

  const rel = confirmation.relationship;
  if (rel.toUserId !== decidingUserId) {
    throw new Error("подтвердить связь может только тот, кого она касается");
  }

  const status: RelationshipStatus = accept ? "VERIFIED" : "REJECTED";
  await prisma.$transaction([
    prisma.relationship.update({
      where: { id: rel.id },
      data: { status, source: "mutual_confirmation" },
    }),
    prisma.relationshipConfirmation.update({
      where: { id: confirmation.id },
      data: { decision: accept ? "ACCEPTED" : "REJECTED", decidedAt: new Date() },
    }),
  ]);

  if (accept) {
    await recordEvent({
      type: "relationship_confirmed",
      userId: decidingUserId,
      payload: { relationshipId: rel.id, type: rel.type },
    });
  }

  await audit({
    actorId: decidingUserId,
    actorRole: "buyer",
    action: accept ? "relationship_confirmed" : "relationship_rejected",
    targetType: "Relationship",
    targetId: rel.id,
    before: { status: "PENDING_CONFIRMATION" },
    after: { status },
  });

  return toInfo(await prisma.relationship.findUniqueOrThrow({ where: { id: rel.id } }));
}

/**
 * What the Gift Agent is allowed to know about a user's circle (spec §12):
 * only VERIFIED relationships plus the note the user themselves wrote.
 * SUGGESTED links are excluded — they are not facts.
 */
export async function getVerifiedCircle(userId: string): Promise<
  Array<{
    otherUserId: string;
    otherUserName: string | null;
    type: string;
    direction: "outgoing" | "incoming";
  }>
> {
  const rels = await prisma.relationship.findMany({
    where: {
      status: "VERIFIED",
      OR: [{ fromUserId: userId }, { toUserId: userId }],
    },
  });
  const otherIds = new Set<string>();
  for (const r of rels) otherIds.add(r.fromUserId === userId ? r.toUserId : r.fromUserId);
  const users = await prisma.user.findMany({
    where: { id: { in: [...otherIds] } },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.name]));

  return rels.map((r) => {
    const outgoing = r.fromUserId === userId;
    return {
      otherUserId: outgoing ? r.toUserId : r.fromUserId,
      otherUserName: byId.get(outgoing ? r.toUserId : r.fromUserId) ?? null,
      type: r.type,
      direction: outgoing ? "outgoing" : "incoming",
    };
  });
}
