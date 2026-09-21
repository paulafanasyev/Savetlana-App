import { describe, it, expect } from "vitest";
import { RELATIONSHIP_TYPES, toInfo } from "../src/lib/domains/relationships";

describe("relationship graph (spec §16)", () => {
  it("supports the spec relationship types", () => {
    expect(RELATIONSHIP_TYPES).toContain("PARENT");
    expect(RELATIONSHIP_TYPES).toContain("CHILD");
    expect(RELATIONSHIP_TYPES).toContain("SPOUSE");
    expect(RELATIONSHIP_TYPES).toContain("FRIEND");
    expect(RELATIONSHIP_TYPES).toContain("COLLEAGUE");
    expect(RELATIONSHIP_TYPES).toContain("BUSINESS_CONTACT");
  });

  it("marks only verified links as facts", () => {
    const suggested = toInfo({
      id: "1",
      fromUserId: "a",
      toUserId: "b",
      type: "FRIEND",
      status: "SUGGESTED",
      source: "social_suggestion",
      confidence: 0.5,
      note: null,
    });
    expect(suggested.isVerifiedFact).toBe(false);

    const verified = toInfo({
      ...suggested,
      status: "VERIFIED",
    });
    expect(verified.isVerifiedFact).toBe(true);
  });

  it("exposes the full status set", () => {
    const statuses = ["SUGGESTED", "DECLARED", "PENDING_CONFIRMATION", "VERIFIED", "REJECTED"];
    for (const s of statuses) {
      const info = toInfo({
        id: "1",
        fromUserId: "a",
        toUserId: "b",
        type: "FRIEND",
        status: s,
        source: "manual",
        confidence: null,
        note: null,
      });
      expect(info.status).toBe(s);
    }
  });
});
