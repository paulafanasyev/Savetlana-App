/**
 * Server-derived idempotency key for consolidated payouts (audit: payout
 * reservation race). Two concurrent requests for the same set of pending
 * settlements produce the same key, so the unique Payout.idempotencyKey
 * guarantees at most one payout per settlement set.
 */
import { createHash } from "node:crypto";

export function payoutIdempotencyKey(sellerId: string, settlementIds: string[]): string {
  const ids = [...settlementIds].sort().join(",");
  const digest = createHash("sha256").update(`${sellerId}|${ids}`).digest("hex").slice(0, 32);
  return `payout:${sellerId}:${digest}`;
}
