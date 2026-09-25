import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  createPendingAction,
  consumePendingAction,
  expireStalePendingActions,
} from "../src/lib/domains/pending-actions";

const USER_A = "pending-action-user-a";
const USER_B = "pending-action-user-b";

async function seedUser(id: string) {
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      email: `${id}@svetlana.example`,
      passwordHash: "test-hash",
      name: "Тест",
      role: "SELLER",
    },
    update: {},
  });
}

describe("pending action confirmation gate (P0 security fix)", () => {
  it("rejects a forged confirm with attacker-chosen arguments", async () => {
    await seedUser(USER_A);
    // Svetlana legitimately surfaced a price change to 90000.
    const stored = await createPendingAction({
      userId: USER_A,
      toolName: "change_price",
      args: { productId: "p1", priceKopecks: 9_000_000 },
      riskLevel: "HIGH_RISK_WRITE",
    });

    // The attacker knows actionId but tries to swap in their own args and a
    // wrong nonce. Both must fail, and the original must stay unconsumed.
    const forgedNonce = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: "0".repeat(48),
    });
    expect(forgedNonce.ok).toBe(false);

    const stillThere = await prisma.pendingAction.findUnique({
      where: { id: stored.actionId },
    });
    expect(stillThere?.status).toBe("PENDING");
  });

  it("rejects a confirm by a different user", async () => {
    await seedUser(USER_A);
    await seedUser(USER_B);
    const stored = await createPendingAction({
      userId: USER_A,
      toolName: "publish_product",
      args: { productId: "p1" },
      riskLevel: "HIGH_RISK_WRITE",
    });

    const crossUser = await consumePendingAction({
      userId: USER_B,
      actionId: stored.actionId,
      nonce: stored.nonce,
    });
    expect(crossUser.ok).toBe(false);
    expect(crossUser.error).toMatch(/принадлежит/);
  });

  it("redeems a legitimate confirm exactly once", async () => {
    await seedUser(USER_A);
    const stored = await createPendingAction({
      userId: USER_A,
      toolName: "confirm_inventory",
      args: { productId: "p1", quantity: 5 },
      riskLevel: "LOW_RISK_WRITE",
    });

    const first = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: stored.nonce,
    });
    expect(first.ok).toBe(true);
    expect(first.action?.toolName).toBe("confirm_inventory");
    expect(first.action?.args).toEqual({ productId: "p1", quantity: 5 });

    // Replay of the now-consumed handle must fail.
    const replay = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: stored.nonce,
    });
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/уже выполнено/);

    const row = await prisma.pendingAction.findUnique({
      where: { id: stored.actionId },
    });
    expect(row?.status).toBe("CONSUMED");
    expect(row?.consumedAt).not.toBeNull();
  });

  it("rejects an expired confirmation", async () => {
    await seedUser(USER_A);
    const stored = await createPendingAction({
      userId: USER_A,
      toolName: "extend_listing",
      args: { productId: "p1" },
      riskLevel: "LOW_RISK_WRITE",
      ttlMinutes: -1,
    });

    const expired = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: stored.nonce,
    });
    expect(expired.ok).toBe(false);
    expect(expired.error).toMatch(/истёк|истек/);
  });

  it("binds a confirmation to its conversation", async () => {
    await seedUser(USER_A);
    const stored = await createPendingAction({
      userId: USER_A,
      conversationId: "conv-1",
      toolName: "create_shipment",
      args: { orderId: "o1" },
      riskLevel: "FINANCIAL",
    });

    const wrongConv = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: stored.nonce,
      conversationId: "conv-other",
    });
    expect(wrongConv.ok).toBe(false);
    expect(wrongConv.error).toMatch(/разговор/);

    const rightConv = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: stored.nonce,
      conversationId: "conv-1",
    });
    expect(rightConv.ok).toBe(true);
  });

  it("detects tampering with the persisted args payload", async () => {
    await seedUser(USER_A);
    const stored = await createPendingAction({
      userId: USER_A,
      toolName: "change_price",
      args: { productId: "p1", priceKopecks: 1_000_000 },
      riskLevel: "FINANCIAL",
    });
    // Corrupt the stored blob; the argsHash must catch it.
    await prisma.pendingAction.update({
      where: { id: stored.actionId },
      data: { args: "corrupted-payload" },
    });

    const tampered = await consumePendingAction({
      userId: USER_A,
      actionId: stored.actionId,
      nonce: stored.nonce,
    });
    expect(tampered.ok).toBe(false);
  });

  it("expires stale actions without touching live ones", async () => {
    await seedUser(USER_A);
    const live = await createPendingAction({
      userId: USER_A,
      toolName: "extend_listing",
      args: {},
      riskLevel: "READ",
      ttlMinutes: 30,
    });
    const stale = await createPendingAction({
      userId: USER_A,
      toolName: "extend_listing",
      args: { stale: true },
      riskLevel: "READ",
      ttlMinutes: -5,
    });

    const swept = await expireStalePendingActions();
    expect(swept).toBeGreaterThanOrEqual(1);

    const liveRow = await prisma.pendingAction.findUnique({ where: { id: live.actionId } });
    const staleRow = await prisma.pendingAction.findUnique({ where: { id: stale.actionId } });
    expect(liveRow?.status).toBe("PENDING");
    expect(staleRow?.status).toBe("EXPIRED");
  });
});
