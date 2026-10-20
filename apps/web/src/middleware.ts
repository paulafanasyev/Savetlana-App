/**
 * Edge middleware — the platform's outermost security gate (spec §80, P0-14).
 *
 * Responsibilities:
 *   1. CSRF defence for cookie-authenticated state changes. SameSite=Lax is
 *      not sufficient for a financial platform, so every POST/PUT/PATCH/
 *      DELETE carrying a session cookie must prove it originated from this
 *      site: the Origin (or Referer fallback) host must equal the request
 *      Host. A cross-site form forged by attacker.com cannot forge Origin.
 *      A cookie-carrying mutation with neither Origin nor Referer is rejected
 *      too (fail-closed): browsers always send Origin on fetch/form POSTs.
 *   2. Content-Security-Policy on every response (audit §24).
 *   3. Passes the requested path to server components (x-forwarded-path) so
 *      a login redirect can bring the user back to the same page.
 *
 * Requests without our session cookie (public APIs, OAuth start, bearer
 * clients) are untouched.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "svetlana_session";
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSP: allow same-origin everything; allow https images/media/styles
 * (product photos live on seller/CDN hosts); nothing from third-party script
 * hosts. connect-src restricted to self so a XSS cannot exfiltrate the
 * session token to a third party.
 *
 * script-src must allow inline scripts: Next.js App Router streams the page
 * data as inline <script> tags. Without them React cannot hydrate, throws away
 * the server HTML and the page turns blank right after loading.
 *
 * Framing: only our own origin may embed our pages (the checkpoint
 * presentation shows live screens of the site in iframes). Third-party sites
 * still cannot frame us, so clickjacking protection is kept.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
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

  const method = request.method.toUpperCase();

  // CSRF gate: only for state-changing requests that carry our session cookie.
  const hasSession = request.cookies.get(SESSION_COOKIE)?.value;
  if (STATE_CHANGING.has(method) && hasSession) {
    const expectedHost = request.headers.get("host")?.toLowerCase();
    // Origin is sent by browsers on all cross-site and same-site fetch/form
    // posts; Referer is the legacy fallback.
    const originHost = hostOf(request.headers.get("origin")) ?? hostOf(request.headers.get("referer"));

    if (expectedHost && originHost !== expectedHost) {
      return NextResponse.json(
        {
          error: "Запрос отклонён: неверный источник. Обновите страницу и попробуйте снова.",
          code: "bad_origin",
        },
        { status: 403 }
      );
    }
  }

  // Forward the trace id and the requested path to route handlers and pages.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-trace-id", traceId);
  forwarded.set("x-forwarded-path", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("x-trace-id", traceId);
  return response;
}

export const config = {
  /**
   * Run on everything except static assets and Next internals. API routes and
   * pages are the surfaces that need the CSRF gate and CSP.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2)$).*)"],
};
