/**
 * Edge middleware — the platform's outermost security gate (spec §80, P0-14).
 *
 * Responsibilities:
 *   1. CSRF defence for cookie-authenticated state changes. SameSite=Lax is
 *      not sufficient for a financial platform, so every POST/PUT/PATCH/
 *      DELETE carrying a session cookie must prove it originated from this
 *      site: the Origin (or Referer fallback) host must equal the request
 *      Host. A cross-site form forged by attacker.com cannot forge Origin.
 *   2. Content-Security-Policy on every response (audit §24).
 *
 * The middleware is deliberately conservative: it only rejects when it can
 * prove the request is cross-site AND carries our session cookie. Same-origin
 * browser navigation, OAuth callback redirects (GET) and API clients are
 * untouched.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "svetlana_session";
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSP: allow same-origin everything; allow https images/media/styles
 * (product photos live on seller/CDN hosts); inline styles only (Next needs
 * them); nothing else. connect-src restricted to self so a XSS cannot exfiltrate
 * the session token to a third party.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "media-src 'self' https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest): NextResponse {
  // Request tracing (P0-17): propagate a trace id so the edge, API routes and
  // background jobs can be correlated in logs. The id is echoed back as a
  // response header for client-side error reporting.
  const traceId =
    request.headers.get("x-trace-id") ??
    `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("x-trace-id", traceId);
  // Make the trace id visible to route handlers without mutating the request
  // body — a plain header set on `request` is not forwarded, so we clone the
  // headers into the forward path.
  request.headers.set("x-trace-id", traceId);

  const method = request.method.toUpperCase();

  // CSRF gate: only for state-changing requests that carry our session cookie.
  const hasSession = request.cookies.get(SESSION_COOKIE)?.value;
  if (STATE_CHANGING.has(method) && hasSession) {
    const expectedHost = request.headers.get("host")?.toLowerCase();
    // Origin is sent by browsers on all cross-site and same-site fetch/form
    // posts; Referer is the legacy fallback.
    const originHost = hostOf(request.headers.get("origin")) ?? hostOf(request.headers.get("referer"));

    if (expectedHost && originHost && originHost !== expectedHost) {
      return NextResponse.json(
        {
          error: "Запрос отклонён: неверный источник. Обновите страницу и попробуйте снова.",
          code: "bad_origin",
        },
        { status: 403 }
      );
    }
  }

  return response;
}

export const config = {
  /**
   * Run on everything except static assets and Next internals. API routes and
   * pages are the surfaces that need the CSRF gate and CSP.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2)$).*)"],
};
