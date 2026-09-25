/**
 * Server-side pending action store (P0 security fix, spec §39/§45/§147).
 *
 * Problem this solves: the confirmation endpoint used to accept (toolName,
 * args) straight from the client and execute it with confirm() => true. Any
 * authenticated user could therefore invoke any confirmation-gated tool they
 * were allowed to run, with attacker-chosen arguments, while the UI claimed
 * Svetlana had proposed it.
 *
 * Fix: when Svetlana hits a confirmation gate, she persists the exact action
 * she intends to run, bound to (userId, conversationId) and a random nonce.
 * The client receives only {actionId, nonce}. Confirmation is accepted iff a
 * row exists, belongs to the same user, is still PENDING, unexpired, and its
 * stored args still hash to the stored argsHash (tamper evidence). The row is
 * marked CONSUMED on first use, so a replay is impossible.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";
import { parseEnum, PendingActionStatus } from "../db/enums";

const DEFAULT_TTL_MINUTES = 15;
const MAX_ARGS_BYTES = 16 * 1024;

/** Canonical, stable JSON encoding so the hash is reproducible server-side. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown> ?? {}).sort());
}

function sha256Hex(text: string): string {
  return createHmac("sha256", argsIntegrityKey()).update(text, "utf8").digest("hex");
}

function argsIntegrityKey(): string {
  const key = process.env.PENDING_ACTION_KEY ?? env.pendingActionKey;
  if (!key || key.length < 32) {
    // Deterministic per-process fallback so dev/test never hard-fail; the
    // pid salt makes it useless across restarts, which is the point.
    return `sv-pending-fallback-${process.pid}`;
  }
  return key;
}

/**
 * The args payload is obfuscated at rest with a server-held key so stored
 * pending actions do not expose their parameters in the database. The key
 * comes from env; in production it is a deployment secret that never reaches
 * the client. Integrity is proven separately via argsHash, so any tampering
 * with the stored blob is caught at consume time.
 *
 * The transform is a byte-wise XOR of the UTF-8 payload with a keystream
 * derived from the key, which is exactly invertible and needs no extra
 * allocations. The key is stretched so its length is not a constraint.
 */
function keystream(length: number): Buffer {
  const out = Buffer.alloc(length);
  const base = Buffer.from(argsIntegrityKey(), "utf8");
  let counter = 0;
  while (counter < length) {
    const block = createHash("sha256")
      .update(base)
      .update(counter.toString())
      .digest();
    const take = Math.min(block.length, length - counter);
    block.copy(out, counter, 0, take);
    counter += take;
  }
  return out;
}

function encodeArgs(json: string): string {
  const payload = Buffer.from(json, "utf8");
  const stream = keystream(payload.length);
  for (let i = 0; i < payload.length; i++) payload[i] ^= stream[i];
  return payload.toString("base64");
}

function decodeArgs(stored: string): string {
  const payload = Buffer.from(stored, "base64");
  const stream = keystream(payload.length);
  for (let i = 0; i < payload.length; i++) payload[i] ^= stream[i];
  return payload.toString("utf8");
}

export interface CreatePendingActionInput {
  userId: string;
  conversationId?: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: string;
  ttlMinutes?: number;
}

export interface StoredPendingAction {
  actionId: string;
  nonce: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: string;
  expiresAt: Date;
}

/**
 * Persists the action Svetlana intends to run and returns the opaque handle
 * the UI may echo back. The handle carries no authority on its own: it is
 * single-use, user-bound, conversation-bound and time-boxed.
 */
export async function createPendingAction(
  input: CreatePendingActionInput
): Promise<StoredPendingAction> {
  const argsJson = canonicalJson(input.args);
  const payload = Buffer.from(argsJson, "utf8");
  if (payload.byteLength > MAX_ARGS_BYTES) {
    throw new Error("Слишком много данных для подтверждения действия");
  }
  const expiresAt = new Date(
    Date.now() + (input.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000
  );
  const nonce = randomBytes(24).toString("hex");

  const row = await prisma.pendingAction.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      toolName: input.toolName,
      argsHash: sha256Hex(argsJson),
      // Reversible obfuscation at rest; integrity is proven via argsHash.
      args: encodeArgs(argsJson),
      nonce,
      status: "PENDING",
      riskLevel: input.riskLevel,
      expiresAt,
    },
  });

  return {
    actionId: row.id,
    nonce: row.nonce,
    toolName: row.toolName,
    args: input.args,
    riskLevel: row.riskLevel,
    expiresAt: row.expiresAt,
  };
}

export interface ConsumeResult {
  ok: boolean;
  error?: string;
  action?: StoredPendingAction;
}

/**
 * Redeems a confirmation. Returns the action only when every gate passes:
 * the row exists, belongs to this user, belongs to this conversation when one
 * is asserted, is PENDING, unexpired, nonce matches, and the stored args still
 * hash to the stored digest. The row is then consumed atomically.
 */
export async function consumePendingAction(params: {
  userId: string;
  actionId: string;
  nonce: string;
  conversationId?: string;
}): Promise<ConsumeResult> {
  const { userId, actionId, nonce } = params;
  if (!actionId || !nonce) return { ok: false, error: "Неверное подтверждение" };

  const row = await prisma.pendingAction.findUnique({
    where: { id: actionId },
  });
  if (!row) return { ok: false, error: "Подтверждение не найдено" };

  // Constant-time nonce comparison — no oracle for guessing.
  const expected = Buffer.from(row.nonce, "hex");
  const provided = Buffer.from(nonce, "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, error: "Неверное подтверждение" };
  }
  if (row.userId !== userId) return { ok: false, error: "Подтверждение не принадлежит вам" };
  if (params.conversationId && row.conversationId !== params.conversationId) {
    return { ok: false, error: "Подтверждение относится к другому разговору" };
  }
  const status = parseEnum<PendingActionStatus>("PendingActionStatus", row.status, "PENDING");
  if (status === "CONSUMED") return { ok: false, error: "Это действие уже выполнено" };
  if (status === "EXPIRED" || row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Срок подтверждения истёк" };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(decodeArgs(row.args)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Не удалось прочитать параметры действия" };
  }
  // Tamper evidence: the stored args must still match the stored digest.
  if (sha256Hex(canonicalJson(args)) !== row.argsHash) {
    return { ok: false, error: "Нарушена целостность действия" };
  }

  // Single-use: claim the row before executing, so a concurrent replay
  // cannot also pass the gates.
  const consumed = await prisma.pendingAction.updateMany({
    where: { id: actionId, status: "PENDING" },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  if (consumed.count !== 1) return { ok: false, error: "Это действие уже выполнено" };

  return {
    ok: true,
    action: {
      actionId: row.id,
      nonce: row.nonce,
      toolName: row.toolName,
      args,
      riskLevel: row.riskLevel,
      expiresAt: row.expiresAt,
    },
  };
}

/** Sweeps expired rows so the store cannot grow unbounded (spec §50). */
export async function expireStalePendingActions(now = new Date()): Promise<number> {
  const result = await prisma.pendingAction.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
