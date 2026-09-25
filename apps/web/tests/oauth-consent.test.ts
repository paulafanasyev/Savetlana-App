import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  createOAuthState,
  consumeOAuthState,
  expireStaleOAuthStates,
} from "../src/lib/domains/oauth-state";
import {
  getConsent,
  hasConsent,
  setConsent,
  listConsents,
} from "../src/lib/domains/consents";

const USER_A = "p0-oauth-user-a";
const USER_B = "p0-oauth-user-b";

async function seedUser(id: string) {
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      email: `${id}@svetlana.example`,
      passwordHash: "x",
      role: "BUYER",
    },
    update: {},
  });
}

describe("oauth state verification (P0 CSRF fix)", () => {
  beforeAll(async () => {
    await seedUser(USER_A);
    await seedUser(USER_B);
    await prisma.oAuthState.deleteMany({});
  });

  it("rejects a callback without a persisted state", async () => {
    const result = await consumeOAuthState({
      state: "never-minted",
      signature: "a".repeat(64),
      userId: USER_A,
      provider: "vk",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a state presented by a different user (forced linking)", async () => {
    const created = await createOAuthState({
      userId: USER_A,
      provider: "vk",
      redirectUri: "https://app/callback",
    });
    const crossUser = await consumeOAuthState({
      state: created.state,
      signature: created.signature,
      userId: USER_B,
      provider: "vk",
    });
    expect(crossUser.ok).toBe(false);
    expect(crossUser.error).toMatch(/другому пользователю/);
  });

  it("rejects a valid state with a forged signature", async () => {
    const created = await createOAuthState({
      userId: USER_A,
      provider: "esia",
      redirectUri: "https://app/callback",
    });
    const forged = await consumeOAuthState({
      state: created.state,
      signature: "0".repeat(64),
      userId: USER_A,
      provider: "esia",
    });
    expect(forged.ok).toBe(false);
  });

  it("rejects a state used for a different provider", async () => {
    const created = await createOAuthState({
      userId: USER_A,
      provider: "vk",
      redirectUri: "https://app/callback",
    });
    const mismatched = await consumeOAuthState({
      state: created.state,
      signature: created.signature,
      userId: USER_A,
      provider: "esia",
    });
    expect(mismatched.ok).toBe(false);
  });

  it("redeems a legitimate state exactly once", async () => {
    const created = await createOAuthState({
      userId: USER_A,
      provider: "vk",
      redirectUri: "https://app/callback",
    });
    const first = await consumeOAuthState({
      state: created.state,
      signature: created.signature,
      userId: USER_A,
      provider: "vk",
    });
    expect(first.ok).toBe(true);
    expect(first.userId).toBe(USER_A);

    const replay = await consumeOAuthState({
      state: created.state,
      signature: created.signature,
      userId: USER_A,
      provider: "vk",
    });
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/использован/);
  });

  it("expires unused states without consuming live ones", async () => {
    const live = await createOAuthState({
      userId: USER_A,
      provider: "esia",
      redirectUri: "https://app/callback",
      ttlMinutes: 30,
    });
    await createOAuthState({
      userId: USER_A,
      provider: "esia",
      redirectUri: "https://app/callback",
      ttlMinutes: -5,
    });
    const swept = await expireStaleOAuthStates();
    expect(swept).toBeGreaterThanOrEqual(1);

    const stillLive = await consumeOAuthState({
      state: live.state,
      signature: live.signature,
      userId: USER_A,
      provider: "esia",
    });
    expect(stillLive.ok).toBe(true);
  });
});

describe("consent gate (P0 fix)", () => {
  beforeAll(async () => {
    await seedUser(USER_A);
    await prisma.consent.deleteMany({ where: { userId: USER_A } });
  });

  it("defaults personalization OFF when the user never opted in", async () => {
    // This is the bug: the row is absent, so the old code fell back to `true`.
    expect(await hasConsent(USER_A, "AI_PERSONALIZATION")).toBe(false);
    expect(await hasConsent(USER_A, "AI_MEMORY")).toBe(false);
    expect(await hasConsent(USER_A, "MARKETING")).toBe(false);
  });

  it("defaults strictly-necessary processing ON", async () => {
    expect(await hasConsent(USER_A, "PERSONAL_DATA")).toBe(true);
    expect(await hasConsent(USER_A, "COOKIES_STRICTLY_NECESSARY")).toBe(true);
  });

  it("records an affirmative opt-in and revocation", async () => {
    const granted = await setConsent({
      userId: USER_A,
      type: "AI_PERSONALIZATION",
      granted: true,
      actorId: USER_A,
    });
    expect(granted.granted).toBe(true);
    expect(await hasConsent(USER_A, "AI_PERSONALIZATION")).toBe(true);

    const revoked = await setConsent({
      userId: USER_A,
      type: "AI_PERSONALIZATION",
      granted: false,
      actorId: USER_A,
    });
    expect(revoked.granted).toBe(false);
    expect(await hasConsent(USER_A, "AI_PERSONALIZATION")).toBe(false);
  });

  it("rejects an unknown consent type instead of storing junk", async () => {
    await expect(
      setConsent({ userId: USER_A, type: "definitely_not_real", granted: true, actorId: USER_A })
    ).rejects.toThrow(/Неизвестный тип согласия/);
  });

  it("lists every consent type with its effective state", async () => {
    const consents = await listConsents(USER_A);
    expect(consents.length).toBeGreaterThan(5);
    const types = consents.map((c) => c.type);
    expect(types).toContain("AI_PERSONALIZATION");
    expect(types).toContain("COOKIES_ADVERTISING");
    const personalization = consents.find((c) => c.type === "AI_PERSONALIZATION");
    expect(personalization?.granted).toBe(false);
  });

  it("leaves an audit trail of the change", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { action: "CONSENT_CHANGED", actorId: USER_A },
    });
    expect(logs.length).toBeGreaterThan(0);
    const last = logs[logs.length - 1];
    expect(JSON.parse(last.after ?? "{}").type).toBe("AI_PERSONALIZATION");
  });
});
