/**
 * Audit Log (spec §38, §140).
 *
 * Every sensitive backend action records actor, action, target, and a
 * before/after snapshot. Sensitive content (passwords, tokens, card numbers)
 * must never be placed in `before`/`after` — callers strip those first.
 */
import { prisma } from "../prisma";

export interface AuditInput {
  actorId?: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ipHash?: string;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const serialize = (v: unknown) =>
      v === undefined ? undefined : JSON.stringify(v).slice(0, 4000);
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: serialize(input.before),
        after: serialize(input.after),
        ipHash: input.ipHash,
      },
    });
  } catch {
    // Audit failure must not break the business operation; it is retried by
    // the observability job. But we never swallow it silently in dev:
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[audit] failed to write audit log for", input.action);
    }
  }
}
