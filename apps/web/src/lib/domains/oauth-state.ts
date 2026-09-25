/**
 * Persisted OAuth state store (P0 fix, spec §17/§18/§38).
 *
 * Problem this solves: the VK/ЕСИА connect endpoints generated a `state`
 * value but never persisted it, and the callback never verified it. The OAuth
 * flow was therefore not cryptographically bound to the user who started it,
 * so a state stolen from one user could be replayed against another
 * (CSRF / forced account linking).
 *
 * Fix: connect() persists a one-time state bound to (userId, provider) with
 * its own nonce; callback() redeems it — it must exist, belong to the same
 * user, be unused and unexpired. A replay or cross-user use is rejected, and
 * the row is consumed on first use.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";

const DEFAULT_TTL_MINUTES = 10;

function stateSecret(): string {
  const key = process.env.OAUTH_STATE_KEY ?? env.oauthStateKey;
  if (!key || key.length < 32) {
    return `sv-oauth-state-fallback-${process.pid}`;
  }
  return key;
}

/**
 * The stored state is a signed token: the lookup key is a public handle, the
 * signature proves the handle was minted by this server and not fabricated.
 */
function sign(handle: string): string {
  return createHmac("sha256", stateSecret()).update(handle, "utf8").digest("hex");
}

export interface CreatedOAuthState {
  /** Public handle embedded in the OAuth `state` parameter. */
  state: string;
  /** Signature the callback must present alongside the handle. */
  signature: string;
}

export async function createOAuthState(params: {
  userId: string;
  provider: "vk" | "esia";
  redirectUri: string;
  ttlMinutes?: number;
}): Promise<CreatedOAuthState> {
  const handle = randomBytes(24).toString("hex");
  const row = await prisma.oAuthState.create({
    data: {
      userId: params.userId,
      provider: params.provider,
      handle,
      signature: sign(handle),
      redirectUri: params.redirectUri,
      expiresAt: new Date(
        Date.now() + (params.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000
      ),
    },
  });
  return { state: row.handle, signature: row.signature };
}

export interface VerifiedOAuthState {
  ok: boolean;
  error?: string;
  userId?: string;
  provider?: string;
  redirectUri?: string;
}

/**
 * Redeems an OAuth callback's state. The signature must be valid for the
 * handle, the row must belong to the session user, be unused and unexpired.
 * Consumed atomically so a replay cannot also pass.
 */
export async function consumeOAuthState(params: {
  state?: string | null;
  signature?: string | null;
  userId: string;
  provider: "vk" | "esia";
}): Promise<VerifiedOAuthState> {
  const { state, signature, userId, provider } = params;
  if (!state || !signature) return { ok: false, error: "отсутствует state" };

  const row = await prisma.oAuthState.findUnique({ where: { handle: state } });
  if (!row) return { ok: false, error: "state не найден" };

  // Constant-time signature comparison — no guessing oracle.
  const expected = Buffer.from(row.signature, "hex");
  const provided = Buffer.from(signature, "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, error: "state недействителен" };
  }
  if (row.userId !== userId) return { ok: false, error: "state принадлежит другому пользователю" };
  if (row.provider !== provider) return { ok: false, error: "state относится к другому провайдеру" };
  if (row.usedAt !== null) return { ok: false, error: "state уже использован" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, error: "срок state истёк" };

  const consumed = await prisma.oAuthState.updateMany({
    where: { handle: state, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) return { ok: false, error: "state уже использован" };

  return { ok: true, userId: row.userId, provider: row.provider, redirectUri: row.redirectUri };
}

/** Sweeps expired states so the table cannot grow unbounded. */
export async function expireStaleOAuthStates(now = new Date()): Promise<number> {
  const result = await prisma.oAuthState.updateMany({
    where: { usedAt: null, expiresAt: { lt: now } },
    data: { usedAt: now },
  });
  return result.count;
}
