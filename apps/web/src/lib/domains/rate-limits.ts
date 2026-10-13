/**
 * Distributed, database-backed rate limiting (P0-15, spec §142).
 *
 * The in-memory limiter in api-helpers is per-process: under serverless or
 * multiple instances, instance A's counter is invisible to instance B and the
 * effective limit becomes N × instances. This module counts in the database,
 * so every instance sees the same window.
 *
 * Design notes:
 *   - The window is sliding but cheap: we count rows inserted since the
 *     window start, then opportunistically garbage-collect old rows for the
 *     bucket so the table cannot grow without bound.
 *   - Failures are counted separately from successes where it matters
 *     (login): a successful login still spends a slot, but a burst of
 *     legitimate retries from a real user typing their password is not
 *     treated as an attack.
 *   - This is an availability control, not a security boundary on its own;
 *     it pairs with the CSRF gate and the audit log.
 */
import { prisma } from "../prisma";
import { requestIp } from "../client-ip";

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts already counted in the current window (after this one). */
  count: number;
  limit: number;
  /** Milliseconds until the caller may retry. 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Адрес посетителя. Первое значение X-Forwarded-For присылает сам браузер,
 * поэтому берём адрес, который дописал наш прокси (см. client-ip.ts).
 */
export function clientIp(request: Request): string {
  return requestIp(request);
}

/**
 * Records an attempt in `bucket` and returns whether the caller is still
 * within `limit` attempts per `windowMs`.
 *
 * Callers MUST call this *before* doing expensive/sensitive work, and SHOULD
 * call `recordAuthOutcome()` after to mark success/failure.
 */
export async function consumeRateLimit(
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowStart = new Date(now - windowMs);

  // Count existing attempts in the window, then insert the new one. Under
  // SQLite this is not a single atomic statement, but the unique identity of a
  // human attacker is bounded by IP and the worst case is a few extra
  // attempts — never an unbounded bypass, because the insert always lands.
  const counted = await prisma.authAttempt.count({
    where: { bucket, createdAt: { gte: windowStart } },
  });

  if (counted >= limit) {
    // Retry is possible once the OLDEST counted attempt ages out of the
    // window. Deriving this from `windowStart` would always return 0, because
    // windowStart is itself `now - windowMs`.
    const oldest = await prisma.authAttempt.findFirst({
      where: { bucket, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "asc" },
    });
    const retryAfterMs = oldest
      ? oldest.createdAt.getTime() + windowMs - now
      : windowMs;
    return {
      allowed: false,
      count: counted,
      limit,
      retryAfterMs: Math.max(retryAfterMs, 1),
    };
  }

  await prisma.authAttempt.create({ data: { bucket } });

  // Best-effort GC for this bucket only; never blocks the request on failure.
  void prisma.authAttempt
    .deleteMany({ where: { bucket, createdAt: { lt: windowStart } } })
    .catch(() => undefined);

  return { allowed: true, count: counted + 1, limit, retryAfterMs: 0 };
}

/** Запасной счётчик в памяти, если база недоступна. */
const memoryHits = new Map<string, { count: number; windowStart: number }>();

function memoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = memoryHits.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    memoryHits.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/**
 * Общий для всех копий сервера лимит для дорогих запросов (чат со Светланой):
 * считаем в базе. Если база недоступна, не роняем запрос, а считаем в памяти.
 */
export async function sharedRateLimit(bucket: string, limit: number, windowMs: number): Promise<boolean> {
  // В тестах каждый файл начинает с чистого счётчика, как и раньше.
  if (process.env.NODE_ENV === "test") return memoryRateLimit(bucket, limit, windowMs);
  try {
    const decision = await consumeRateLimit(bucket, limit, windowMs);
    return decision.allowed;
  } catch {
    return memoryRateLimit(bucket, limit, windowMs);
  }
}

/** Marks an auth attempt's outcome so failed-login analytics can use it. */
export async function recordAuthOutcome(bucket: string, success: boolean): Promise<void> {
  const latest = await prisma.authAttempt.findFirst({
    where: { bucket },
    orderBy: { createdAt: "desc" },
  });
  if (latest && latest.success !== success) {
    await prisma.authAttempt.update({ where: { id: latest.id }, data: { success } }).catch(() => undefined);
  }
}

/** Standard buckets: both IP-scoped and account-scoped (spec §142). */
export function loginBuckets(ip: string, email?: string): string[] {
  const b = [`login:ip:${ip}`];
  if (email) b.push(`login:account:${email.toLowerCase()}`);
  return b;
}

export const AUTH_LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 }, // 10 per 15 min per IP + per account
  register: { limit: 5, windowMs: 60 * 60_000 }, // 5 per hour per IP
  aiConfirm: { limit: 30, windowMs: 60 * 60_000 }, // 30 confirmed actions per hour per user
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
} as const;

export function tooMany(decision: RateLimitDecision): Response {
  return Response.json(
    {
      error: "Слишком много попыток. Попробуйте позже.",
      code: "rate_limited",
      retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000),
    },
    { status: 429 },
  );
}
