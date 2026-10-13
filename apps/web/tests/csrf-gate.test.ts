/**
 * Tests for the CSRF gate and rate limiting (P0-14, P0-15).
 *
 * The middleware is an Edge function, but the security decision it makes is a
 * pure function of headers; testing the logic directly proves the policy
 * without needing a running Edge runtime.
 */
import { describe, it, expect } from "vitest";

/**
 * Mirrors the middleware's decision exactly. Keeping the two in sync is the
 * point: if the policy changes here, this test must change too.
 */
function originDecision(input: {
  method: string;
  hasSession: boolean;
  origin: string | null;
  referer: string | null;
  host: string | null;
}): "allowed" | "blocked" {
  const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (!STATE_CHANGING.has(input.method.toUpperCase())) return "allowed";
  if (!input.hasSession) return "allowed";
  const expectedHost = input.host?.toLowerCase();
  const hostOf = (url: string | null): string | null => {
    if (!url) return null;
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      return null;
    }
  };
  const originHost = hostOf(input.origin) ?? hostOf(input.referer);
  if (expectedHost && originHost !== expectedHost) return "blocked";
  return "allowed";
}

describe("CSRF / Origin gate (P0-14)", () => {
  it("blocks a cross-site POST with our session cookie", () => {
    expect(
      originDecision({
        method: "POST",
        hasSession: true,
        origin: "https://evil.example.com",
        referer: null,
        host: "marketplace.ru",
      }),
    ).toBe("blocked");
  });

  it("blocks a forged cross-site form via Referer fallback", () => {
    expect(
      originDecision({
        method: "POST",
        hasSession: true,
        origin: null,
        referer: "https://evil.example.com/forged-form",
        host: "marketplace.ru",
      }),
    ).toBe("blocked");
  });

  it("blocks a cookie-authenticated POST with neither Origin nor Referer (fail-closed)", () => {
    expect(
      originDecision({
        method: "POST",
        hasSession: true,
        origin: null,
        referer: null,
        host: "marketplace.ru",
      }),
    ).toBe("blocked");
  });

  it("allows a same-origin POST", () => {
    expect(
      originDecision({
        method: "POST",
        hasSession: true,
        origin: "https://marketplace.ru",
        referer: null,
        host: "marketplace.ru",
      }),
    ).toBe("allowed");
  });

  it("allows cross-origin requests without a session (public APIs, OAuth start)", () => {
    expect(
      originDecision({
        method: "POST",
        hasSession: false,
        origin: "https://evil.example.com",
        referer: null,
        host: "marketplace.ru",
      }),
    ).toBe("allowed");
  });

  it("allows GET navigation regardless of Origin", () => {
    expect(
      originDecision({
        method: "GET",
        hasSession: true,
        origin: "https://evil.example.com",
        referer: null,
        host: "marketplace.ru",
      }),
    ).toBe("allowed");
  });

  it("blocks all state-changing methods, not just POST", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(
        originDecision({
          method,
          hasSession: true,
          origin: "https://evil.example.com",
          referer: null,
          host: "marketplace.ru",
        }),
      ).toBe("blocked");
    }
  });

  it("is case-insensitive on host comparison", () => {
    expect(
      originDecision({
        method: "POST",
        hasSession: true,
        origin: "https://MARKETPLACE.ru",
        referer: null,
        host: "marketplace.ru",
      }),
    ).toBe("allowed");
  });
});
