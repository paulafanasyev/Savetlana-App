/**
 * Observability + secret redaction (P0-17, spec §38/§87).
 *
 * The logger is the boundary between internal state and a log aggregator. If
 * redaction misses a field, a secret lands in a log file — so the redactor is
 * tested directly against the shapes that actually flow through it.
 */
import { describe, it, expect } from "vitest";
import { redact } from "../src/lib/logger";

describe("logger redaction", () => {
  it("strips known secret keys at any depth", () => {
    const payload = {
      user: "u1",
      password: "hunter2",
      nested: { apiKey: "sk_live_123", safe: "keep" },
      list: [{ token: "abc" }, { ok: 1 }],
    };
    const out = redact(payload) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).safe).toBe("keep");
    expect(((out.list as Record<string, unknown>[])[0] as Record<string, unknown>).token).toBe("[redacted]");
  });

  it("strips Authorization and cookie headers", () => {
    const out = redact({
      authorization: "Bearer eyJ.xxx.yyy",
      cookie: "svetlana_session=secret",
      path: "/api/health",
    }) as Record<string, unknown>;
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out.path).toBe("/api/health");
  });

  it("redacts keys that merely hint at secrets", () => {
    const out = redact({ refreshToken: "x", userPasswordHash: "y", normal: 1 }) as Record<string, unknown>;
    expect(out.refreshToken).toBe("[redacted]");
    expect(out.userPasswordHash).toBe("[redacted]");
    expect(out.normal).toBe(1);
  });

  it("truncates oversized strings so a token cannot flood the log", () => {
    const huge = "a".repeat(5000);
    const out = redact({ blob: huge }) as Record<string, unknown>;
    const blob = out.blob as string;
    expect(blob.length).toBeLessThan(200);
    expect(blob).toContain("5000 chars");
  });

  it("collapses deep arrays instead of dumping them", () => {
    const out = redact({ items: Array.from({ length: 100 }, (_, i) => i) }) as Record<string, unknown>;
    const items = out.items as unknown[];
    expect(items.length).toBe(9);
    expect(items[8]).toBe("[92 more]");
  });

  it("survives null, undefined and cycles without throwing", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => redact({ n: null, u: undefined, c: cyclic })).not.toThrow();
  });
});
