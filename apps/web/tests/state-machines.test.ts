import { describe, it, expect } from "vitest";
import { canTransition, ORDER_STATES } from "../src/lib/domains/orders";
import { canTransitionShipment, SHIPMENT_STATES } from "../src/lib/domains/delivery";
import { canTransitionDocument } from "../src/lib/domains/documents";
import { canTransitionDispute } from "../src/lib/domains/disputes";

describe("order state machine", () => {
  it("lists the spec §29 order statuses", () => {
    expect(ORDER_STATES).toContain("CREATED");
    expect(ORDER_STATES).toContain("PAYMENT_PENDING");
    expect(ORDER_STATES).toContain("DELIVERED");
    expect(ORDER_STATES).toContain("COMPLETED");
    expect(ORDER_STATES).toContain("CANCELLED");
    expect(ORDER_STATES).toContain("DISPUTED");
  });

  it("allows the happy path", () => {
    expect(canTransition("CREATED", "PAYMENT_PENDING")).toBe(true);
    expect(canTransition("PAYMENT_PENDING", "PAID")).toBe(true);
    expect(canTransition("PAID", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "HANDED_TO_CARRIER")).toBe(true);
    expect(canTransition("HANDED_TO_CARRIER", "IN_TRANSIT")).toBe(true);
    expect(canTransition("IN_TRANSIT", "DELIVERED")).toBe(true);
    expect(canTransition("DELIVERED", "COMPLETED")).toBe(true);
  });

  it("forbids skipping payment", () => {
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
    expect(canTransition("CREATED", "DELIVERED")).toBe(false);
  });

  it("forbids resurrecting terminal states", () => {
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
  });
});

describe("shipment state machine", () => {
  it("follows carrier reality", () => {
    expect(SHIPMENT_STATES).toContain("CREATED");
    expect(canTransitionShipment("CREATED", "HANDED_OVER")).toBe(true);
    expect(canTransitionShipment("HANDED_OVER", "IN_TRANSIT")).toBe(true);
    expect(canTransitionShipment("IN_TRANSIT", "DELIVERED")).toBe(true);
    expect(canTransitionShipment("IN_TRANSIT", "FAILED")).toBe(true);
    expect(canTransitionShipment("FAILED", "RETURNED")).toBe(true);
  });

  it("cannot go backwards from delivered", () => {
    expect(canTransitionShipment("DELIVERED", "IN_TRANSIT")).toBe(false);
  });
});

describe("document state machine", () => {
  it("requires review before verification", () => {
    expect(canTransitionDocument("UPLOADED", "PROCESSING")).toBe(true);
    expect(canTransitionDocument("PROCESSING", "PENDING_REVIEW")).toBe(true);
    expect(canTransitionDocument("PENDING_REVIEW", "VERIFIED")).toBe(true);
    expect(canTransitionDocument("PENDING_REVIEW", "REJECTED")).toBe(true);
    expect(canTransitionDocument("VERIFIED", "EXPIRED")).toBe(true);
  });

  it("never claims verified straight from upload", () => {
    expect(canTransitionDocument("UPLOADED", "VERIFIED")).toBe(false);
  });
});

describe("dispute state machine", () => {
  it("escalates to a human, never self-verifies", () => {
    expect(canTransitionDispute("OPEN", "EVIDENCE_COLLECTION")).toBe(true);
    expect(canTransitionDispute("EVIDENCE_COLLECTION", "ESCALATED_HUMAN")).toBe(true);
    expect(canTransitionDispute("ESCALATED_HUMAN", "RESOLVED_BUYER")).toBe(true);
    expect(canTransitionDispute("OPEN", "RESOLVED_SELLER")).toBe(false);
  });
});
