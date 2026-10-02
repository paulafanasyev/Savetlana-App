/**
 * Route-handler plumbing shared by every API route.
 *
 * Wraps a handler so that:
 *   - ApiError becomes a structured JSON response with a Russian message
 *   - unexpected errors never leak internals to the client
 *   - every response carries safe, minimal headers
 */
import { ApiError, apiErrorResponse } from "./auth";

/** Route params as Next delivers them: scalar segments are strings, and a
 *  catch-all (`[...path]`) segment is an array. */
export type RouteParamsShape = Record<string, string | string[]>;

/** `P` defaults to the common all-scalar shape so ordinary routes keep writing
 *  `params.id` as a plain `string`; catch-all routes infer `{ path: string[] }`. */
export type RouteHandler<P extends RouteParamsShape = Record<string, string>> = (
  request: Request,
  ctx: { params: P }
) => Promise<Response> | Response;

/**
 * Next 15 made `params` a Promise in route handlers. Handlers still receive a
 * plain object — the unwrapping happens once, here, so no individual route has
 * to know. The declared type matches what Next requires; the runtime resolver
 * additionally tolerates a plain object so handlers stay callable from tests.
 */
async function resolveParams<P extends RouteParamsShape>(params: unknown): Promise<P> {
  if (params && typeof (params as PromiseLike<P>).then === "function") {
    return ((await (params as PromiseLike<P>)) ?? {}) as P;
  }
  return (params as P) ?? ({} as P);
}

function safeHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function apiRoute<P extends RouteParamsShape = Record<string, string>>(
  handler: RouteHandler<P>
): (request: Request, ctx: { params: Promise<P> }) => Promise<Response> {
  return async (request, ctx) => {
    try {
      const response = await handler(request, { params: await resolveParams<P>(ctx?.params) });
      return safeHeaders(response);
    } catch (error) {
      // next/navigation's redirect() throws a sentinel error that the App
      // Router turns into a real 303. It must propagate, not be reported as
      // a 500 — the mutation has already committed at this point.
      const digest = (error as { digest?: string })?.digest;
      if (digest?.startsWith("NEXT_REDIRECT")) {
        throw error;
      }
      if (error instanceof ApiError) {
        return safeHeaders(apiErrorResponse(error));
      }
      // eslint-disable-next-line no-console
      console.error("[api] unhandled error", error);
      return safeHeaders(
        Response.json(
          {
            error: "Не удалось выполнить запрос. Попробуйте позже.",
            code: "internal_error",
          },
          { status: 500 }
        )
      );
    }
  };
}

/**
 * In-session idempotency guard for mutating routes. The client sends
 * Idempotency-Key; a replay returns the stored result instead of a second
 * mutation (spec §125).
 */
export function readIdempotencyKey(request: Request): string | undefined {
  const key = request.headers.get("x-idempotency-key") ?? request.headers.get("idempotency-key");
  return key && key.length > 0 && key.length <= 128 ? key : undefined;
}

export function jsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

/** Simple per-route request cap to protect expensive endpoints (spec §142). */
const hitCounts = new Map<string, { count: number; windowStart: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hitCounts.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    hitCounts.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

export function tooManyRequests(): Response {
  return Response.json(
    { error: "Слишком много запросов. Попробуйте позже.", code: "rate_limited" },
    { status: 429 }
  );
}
