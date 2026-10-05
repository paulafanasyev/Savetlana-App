import { describe, it, expect } from "vitest";
import path from "node:path";
import { isPathWithinRoot } from "../src/lib/path-safety";
import { payoutIdempotencyKey } from "../src/lib/payout-key";

describe("storage path containment", () => {
  const root = path.resolve("/tmp/uploads");
  it("accepts files inside the root", () => {
    expect(isPathWithinRoot(root, path.resolve(root, "private/u1/file.png"))).toBe(true);
  });
  it("rejects sibling directories that share the root prefix", () => {
    expect(isPathWithinRoot(root, path.resolve(root, "../uploads-evil/file.png"))).toBe(false);
  });
  it("rejects parent traversal", () => {
    expect(isPathWithinRoot(root, path.resolve(root, "../../etc/passwd"))).toBe(false);
  });
});

describe("payout idempotency key", () => {
  it("is identical for the same settlement set in any order", () => {
    expect(payoutIdempotencyKey("s1", ["b", "a", "c"])).toBe(payoutIdempotencyKey("s1", ["c", "b", "a"]));
  });
  it("differs per seller and per settlement set", () => {
    const base = payoutIdempotencyKey("s1", ["a", "b"]);
    expect(payoutIdempotencyKey("s2", ["a", "b"])).not.toBe(base);
    expect(payoutIdempotencyKey("s1", ["a", "b", "c"])).not.toBe(base);
  });
});
