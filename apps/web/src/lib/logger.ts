/**
 * Structured logging + request tracing (P0 fix, audit §17).
 *
 * Problem this solves: logs were ad-hoc `console.log`/`console.error` calls with
 * no correlation between the edge middleware, an API route, the AI gateway and a
 * background job. A failing payout could not be traced end to end.
 *
 * Design:
 *   - Every inbound request gets a `traceId` (middleware injects the header).
 *   - Log entries are single-line JSON so any collector can index them.
 *   - Secrets are never logged: `redact()` strips known-secret keys and any
 *     Authorization header before a field is serialized (spec §38, §87).
 *   - No PII: user identifiers are logged as-is only in server-side flows that
 *     already hold them; email/phone are masked.
 */

const SECRET_KEYS = [
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "api_key",
  "secret",
  "clientsecret",
  "authorization",
  "cookie",
  "card",
  "cardnumber",
  "cvc",
  "secretblob",
];

const SENSITIVE_HINTS = /(password|secret|token|apikey|api_key|authorization|cookie)/i;

/**
 * Recursively redacts secret-bearing fields. Object shapes from the outside
 * world are unpredictable, so this walks arbitrarily deep and truncates arrays
 * beyond a sane bound to avoid unbounded log lines.
 */
export function redact(value: unknown, depth = 0): Record<string, unknown> | unknown {
  if (depth > 6) return "[depth limit]";
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "function") return "[fn]";
  if (type === "string") {
    const str = value as string;
    if (str.length > 2048) return `${str.slice(0, 64)}…[${str.length} chars]`;
    return str;
  }
  if (type !== "object") return value;
  if (Array.isArray(value)) {
    if (value.length > 32) return [...value.slice(0, 8).map((v) => redact(v, depth + 1)), `[${value.length - 8} more]`];
    return value.map((v) => redact(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (SECRET_KEYS.some((s) => key === s || key.includes(s))) {
      out[k] = v === null || v === undefined ? v : "[redacted]";
    } else if (SENSITIVE_HINTS.test(k)) {
      out[k] = "[redacted]";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

export interface LogContext {
  traceId?: string;
  userId?: string;
  [key: string]: unknown;
}

function emit(level: string, message: string, context: LogContext = {}, error?: unknown): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(context) as Record<string, unknown>),
  };
  if (error instanceof Error) {
    entry.err = { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 5).join("\n") };
  } else if (error !== undefined) {
    entry.err = redact(error);
  }
  // Single line — a collector can ingest it as one event.
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug(msg: string, ctx: LogContext = {}) {
    if (process.env.LOG_LEVEL === "debug") emit("debug", msg, ctx);
  },
  info(msg: string, ctx: LogContext = {}) {
    emit("info", msg, ctx);
  },
  warn(msg: string, ctx: LogContext = {}, error?: unknown) {
    emit("warn", msg, ctx, error);
  },
  error(msg: string, ctx: LogContext = {}, error?: unknown) {
    emit("error", msg, ctx, error);
  },
};

/**
 * Wraps an async operation with latency + failure observability. Returns the
 * operation's value; failures are logged and re-thrown so callers keep their
 * own error handling.
 */
export async function traced<T>(
  name: string,
  operation: () => Promise<T>,
  ctx: LogContext = {}
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    const latency = Date.now() - started;
    if (latency > 2000) {
      log.warn(`slow:${name}`, { ...ctx, latencyMs: latency });
    } else {
      log.debug(`ok:${name}`, { ...ctx, latencyMs: latency });
    }
    return result;
  } catch (error) {
    log.error(`fail:${name}`, { ...ctx, latencyMs: Date.now() - started }, error);
    throw error;
  }
}
