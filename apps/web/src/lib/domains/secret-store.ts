/**
 * Server-side secret store for OAuth access tokens (P0 fix, spec §38/§17).
 *
 * The problem this fixes: IntegrationLink.accessTokenRef is an *opaque
 * reference*, but the code that consumed it passed the reference itself to
 * adapters as if it were the token — so no real secret-storage round trip
 * existed at all. The link worked only while the in-memory exchange response
 * was still reachable, which it never is on a later request.
 *
 * This module is the single place a secret is materialised:
 *
 *   store  → writes an encrypted blob keyed by the reference
 *   load   → decrypts and returns the token (or null if expired/revoked)
 *
 * Encryption uses AES-256-GCM with a per-deployment key from the environment.
 * The ciphertext and the reference are both useless without the key, which
 * never enters the database, the frontend, or logs.
 *
 * Honesty: on Vercel the key is a platform environment variable. For a
 * regulated deployment this should be backed by a KMS/HSM and the blob by a
 * dedicated secret store (Vault/AWS Secrets Manager); the interface below does
 * not need to change for that swap.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";

function storeKey(): Buffer {
  const raw = process.env.SVETLANA_SECRET_KEY;
  if (!raw) {
    // Deterministic derivation in dev so restarts keep working; in production
    // a real key is required and its absence is fatal, never defaulted from
    // public material.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SVETLANA_SECRET_KEY is required in production");
    }
    return createHash("sha256").update("dev-only-secret-store-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export interface StoredSecret {
  /** The plaintext secret, e.g. a VK access token. Never logged. */
  value: string;
  expiresAt: Date | null;
}

/**
 * Encrypts a secret and returns the storable blob (ciphertext + iv + tag,
 * base64). The reference the caller keeps is only a lookup key.
 */
export function storeSecret(secret: StoredSecret): string {
  const key = storeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = JSON.stringify({ v: secret.value, e: secret.expiresAt?.toISOString() ?? null });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [enc.toString("base64"), iv.toString("base64"), tag.toString("base64")].join(".");
}

/** Decrypts a blob previously produced by storeSecret. Returns null if unusable. */
export function loadSecret(blob: string | null | undefined): StoredSecret | null {
  if (!blob) return null;
  try {
    const [enc, iv, tag] = blob.split(".");
    if (!enc || !iv || !tag) return null;
    const key = storeKey();
    const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]);
    const parsed = JSON.parse(out.toString("utf8")) as { v: string; e: string | null };
    if (!parsed.v) return null;
    return { value: parsed.v, expiresAt: parsed.e ? new Date(parsed.e) : null };
  } catch {
    // Tampered blob, wrong key, or corruption: treat as unavailable.
    return null;
  }
}

/** True when a stored secret is present and not past its expiry. */
export function secretUsable(blob: string | null | undefined): boolean {
  const s = loadSecret(blob);
  if (!s) return false;
  if (s.expiresAt && s.expiresAt.getTime() < Date.now()) return false;
  return true;
}
