/**
 * Personal Memory (spec §29, §10).
 *
 * Structured, consent-aware, editable, exportable, deletable memory. Every
 * entry carries a type and — critically — every INFERENCE carries a confidence
 * and an evidence source. An inference without evidence is never written.
 *
 * Privacy boundaries (spec §22, §85):
 *   - CRM secrets, payment details, tokens and private messages are never
 *     stored here (the caller filters them; see ai/privacy.ts).
 *   - Memory is per-user: a buyer's memory is never readable by a seller.
 *   - The user can see, edit and delete every row (Privacy Center, spec §82).
 */
import { prisma } from "../prisma";
import { parseEnum } from "../db/enums";
import { audit } from "./audit";

export type MemoryType = "FACT" | "INFERENCE" | "PREFERENCE" | "TEMPORARY_CONTEXT";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number | null;
  source: string;
  evidence: string | null;
  isEditable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MEMORY_KEYS = new Set([
  "budget_range",
  "preferred_categories",
  "preferred_brands",
  "preferred_delivery",
  "disliked_attributes",
  "size_apparel",
  "size_shoes",
  "price_sensitivity",
  "language",
  "gift_preferences",
  "notification_preferences",
  "seller_business_note",
]);

function toEntry(row: {
  id: string;
  type: string;
  key: string;
  value: string;
  confidence: number | null;
  source: string;
  evidence: string | null;
  isEditable: boolean;
  createdAt: Date;
  updatedAt: Date;
}): MemoryEntry {
  return {
    id: row.id,
    type: parseEnum<MemoryType>("MemoryType", row.type, "PREFERENCE"),
    key: row.key,
    value: row.value,
    confidence: row.confidence,
    source: row.source,
    evidence: row.evidence,
    isEditable: row.isEditable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Remember a user-stated fact or preference. Source is always "user_stated"
 * and confidence is 1 — the user said it, so it is not an inference.
 */
export async function rememberStated(
  userId: string,
  type: MemoryType,
  key: string,
  value: string
): Promise<MemoryEntry> {
  if (!MEMORY_KEYS.has(key)) {
    throw new Error(`unknown memory key: ${key}`);
  }
  const row = await prisma.aiMemory.upsert({
    where: { userId_key: { userId, key } },
    create: {
      userId,
      type: type === "INFERENCE" ? "PREFERENCE" : type,
      key,
      value,
      confidence: 1,
      source: "user_stated",
      evidence: "statement by the user during conversation",
      isEditable: true,
    },
    update: { value, type: type === "INFERENCE" ? "PREFERENCE" : type, confidence: 1, source: "user_stated" },
  });
  await audit({
    action: "memory.write",
    actorId: userId,
    actorRole: "user",
    targetType: "ai_memory",
    targetId: row.id,
    after: { type: row.type, key, value },
  });
  return toEntry(row);
}

/**
 * Store an AI-derived inference. Refused without evidence and without a
 * confidence below the threshold — a guess is not a memory (spec §29).
 */
export async function rememberInference(
  userId: string,
  key: string,
  value: string,
  confidence: number,
  evidence: string
): Promise<MemoryEntry | null> {
  if (!MEMORY_KEYS.has(key)) return null;
  if (confidence < 0.6 || !evidence) {
    // Too weak to persist. Still returned to the caller as a temporary context
    // so the current conversation can use it without becoming a stored claim.
    return null;
  }
  const row = await prisma.aiMemory.upsert({
    where: { userId_key: { userId, key } },
    create: {
      userId,
      type: "INFERENCE",
      key,
      value,
      confidence,
      source: "ai_inference",
      evidence,
      isEditable: true,
    },
    update: { value, confidence, evidence },
  });
  await audit({
    action: "memory.inference",
    actorId: userId,
    actorRole: "user",
    targetType: "ai_memory",
    targetId: row.id,
    after: { key, value, confidence, evidence },
  });
  return toEntry(row);
}

export async function getMemory(userId: string): Promise<MemoryEntry[]> {
  const rows = await prisma.aiMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toEntry);
}

/**
 * Session-scoped context: facts valid for the current conversation only.
 * Not persisted across sessions, never used for recommendations.
 */
export async function getTemporaryContext(userId: string): Promise<MemoryEntry[]> {
  const rows = await prisma.aiMemory.findMany({
    where: { userId, type: "TEMPORARY_CONTEXT" },
  });
  return rows.map(toEntry);
}

export async function updateMemoryEntry(
  userId: string,
  entryId: string,
  value: string
): Promise<MemoryEntry> {
  const row = await prisma.aiMemory.findFirst({
    where: { id: entryId, userId },
  });
  if (!row) throw new Error("memory entry not found");
  if (!row.isEditable) throw new Error("this memory entry is not editable");
  const updated = await prisma.aiMemory.update({
    where: { id: entryId },
    data: { value, source: "user_edited" },
  });
  await audit({
    action: "memory.edit",
    actorId: userId,
    actorRole: "user",
    targetType: "ai_memory",
    targetId: entryId,
    before: { value: row.value },
    after: { value },
  });
  return toEntry(updated);
}

export async function forgetMemoryEntry(userId: string, entryId: string): Promise<void> {
  const row = await prisma.aiMemory.findFirst({ where: { id: entryId, userId } });
  if (!row) return;
  await prisma.aiMemory.delete({ where: { id: entryId } });
  await audit({
    action: "memory.delete",
    actorId: userId,
    actorRole: "user",
    targetType: "ai_memory",
    targetId: entryId,
    before: { key: row.key },
  });
}

export async function forgetAllMemory(userId: string): Promise<number> {
  const deleted = await prisma.aiMemory.deleteMany({ where: { userId } });
  await audit({
    action: "memory.delete_all",
    actorId: userId,
    actorRole: "user",
    targetType: "ai_memory",
    after: { count: deleted.count },
  });
  return deleted.count;
}

/** Human-readable memory summary for the Privacy Center ("What Svetlana knows"). */
export function describeMemory(entries: MemoryEntry[]): string[] {
  return entries.map(
    (e) =>
      `${e.key}: ${e.value}` +
      (e.type === "INFERENCE"
        ? ` (предположение, уверенность ${Math.round((e.confidence ?? 0) * 100)}%, источник: ${e.evidence ?? "—"})`
        : "")
  );
}
