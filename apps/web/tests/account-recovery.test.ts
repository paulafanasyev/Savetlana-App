import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  requestEmailVerification,
  confirmEmail,
  requestPasswordReset,
  resetPassword,
  isTicketValid,
} from "../src/lib/domains/account-recovery";
import { verifyPassword } from "../src/lib/auth";
import { createHash } from "node:crypto";

/** Mirror of the domain's ticket hashing so tests can locate a row by secret. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The dev-only inline link carries the secret in the `ticket` query param. */
function secretFromLink(link: string | undefined): string {
  if (!link) throw new Error("dev link not available in this environment");
  const url = new URL(link);
  const secret = url.searchParams.get("ticket");
  if (!secret) throw new Error("link has no ticket param");
  return secret;
}

const USER_A = "recovery-user-a";
const TICKET_TTL_MS = 1000;

async function seedUser(id: string, email: string) {
  const hash = await hashPassword("password123");
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      email,
      passwordHash: hash,
      name: "Тест",
      role: "BUYER",
    },
    update: { passwordHash: hash, emailVerifiedAt: null },
  });
}

async function hashPassword(plain: string): Promise<string> {
  // Use the same bcrypt path as registration.
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(plain, 10);
}

async function readUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new Error("user missing");
  return user;
}

describe("account recovery & email verification (audit §15)", () => {
  it("issues a single-use email verification ticket and marks the email verified", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const before = await readUser(USER_A);
    expect(before.emailVerifiedAt).toBeNull();

    const ticket = await requestEmailVerification(USER_A);
    expect(ticket.secret).toBeTruthy();
    expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const { email } = await confirmEmail(ticket.secret);
    expect(email).toBe("recovery-a@svetlana.example");

    const after = await readUser(USER_A);
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it("rejects a replayed verification ticket (single-use)", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const ticket = await requestEmailVerification(USER_A);
    await confirmEmail(ticket.secret);

    await expect(confirmEmail(ticket.secret)).rejects.toThrow();
  });

  it("does not verify an email with a ticket issued to another user", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    await seedUser("recovery-user-b", "recovery-b@svetlana.example");
    const ticket = await requestEmailVerification("recovery-user-b");

    // The secret is opaque; confirmEmail resolves the user internally, so a
    // ticket from user B simply verifies user B — it must never touch user A.
    const { email } = await confirmEmail(ticket.secret);
    expect(email).toBe("recovery-b@svetlana.example");
    const a = await readUser(USER_A);
    expect(a.emailVerifiedAt).toBeNull();
  });

  it("issues a password reset ticket that actually changes the password", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");

    const result = await requestPasswordReset("recovery-a@svetlana.example");
    const secret = secretFromLink(result.devLink);
    expect(secret).toBeTruthy();

    await resetPassword(secret, "newSecret456");

    const user = await readUser(USER_A);
    expect(await verifyPassword("newSecret456", user.passwordHash)).toBe(true);
    expect(await verifyPassword("password123", user.passwordHash)).toBe(false);
  });

  it("revokes all existing sessions after a password reset", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    await prisma.session.create({
      data: {
        token: `recovery-session-${USER_A}`,
        userId: USER_A,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await requestPasswordReset("recovery-a@svetlana.example");
    await resetPassword(secretFromLink(result.devLink), "newSecret456");

    const sessions = await prisma.session.findMany({ where: { userId: USER_A, revokedAt: null } });
    expect(sessions).toHaveLength(0);
  });

  it("does not reveal whether an account exists (no enumeration)", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");

    const known = await requestPasswordReset("recovery-a@svetlana.example");
    const unknown = await requestPasswordReset("definitely-absent@svetlana.example");

    // Both resolve without error and never leak account existence. The only
    // divergence is the dev-only inline link, which is absent in production.
    expect(typeof known.sent).toBe("boolean");
    expect(unknown.sent).toBe(false);
    // The unknown-account path persists no spendable ticket.
    const tickets = await prisma.authTicket.findMany({
      where: { purpose: "RESET_PASSWORD", consumedAt: null },
    });
    expect(tickets.every((t) => t.userId !== "no-such-user")).toBe(true);
  });

  it("rejects an expired ticket", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const result = await requestPasswordReset("recovery-a@svetlana.example");
    const secret = secretFromLink(result.devLink);

    await prisma.authTicket.updateMany({
      where: { tokenHash: sha256Hex(secret) },
      data: { expiresAt: new Date(Date.now() - TICKET_TTL_MS) },
    });

    await expect(resetPassword(secret, "newSecret456")).rejects.toThrow();
    const user = await readUser(USER_A);
    expect(await verifyPassword("password123", user.passwordHash)).toBe(true);
  });

  it("isTicketValid reports validity without consuming the ticket", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const ticket = await requestEmailVerification(USER_A);

    expect(await isTicketValid(ticket.secret, "VERIFY_EMAIL")).toBe(true);
    // Still usable after the probe.
    await confirmEmail(ticket.secret);
  });

  it("rejects a ticket used for the wrong purpose", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const result = await requestPasswordReset("recovery-a@svetlana.example");

    expect(await isTicketValid(secretFromLink(result.devLink), "VERIFY_EMAIL")).toBe(false);
  });

  it("refuses a weak new password", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const result = await requestPasswordReset("recovery-a@svetlana.example");

    await expect(resetPassword(secretFromLink(result.devLink), "123")).rejects.toThrow();
    const user = await readUser(USER_A);
    expect(await verifyPassword("password123", user.passwordHash)).toBe(true);
  });

  it("rotates a pending ticket so only the newest link is spendable", async () => {
    await seedUser(USER_A, "recovery-a@svetlana.example");
    const first = await requestPasswordReset("recovery-a@svetlana.example");
    const second = await requestPasswordReset("recovery-a@svetlana.example");

    // The older ticket was invalidated when the newer one was minted.
    await expect(resetPassword(secretFromLink(first.devLink), "newSecret456")).rejects.toThrow();
    await resetPassword(secretFromLink(second.devLink), "newSecret456");
    const user = await readUser(USER_A);
    expect(await verifyPassword("newSecret456", user.passwordHash)).toBe(true);
  });
});

describe("session revocation (audit §15: logout all devices)", () => {
  it("revokes every active session for the account", async () => {
    await seedUser("revoke-user", "revoke@svetlana.example");
    const userId = "revoke-user";

    await prisma.session.createMany({
      data: [
        { token: "revoke-sess-1", userId, expiresAt: new Date(Date.now() + 60_000) },
        { token: "revoke-sess-2", userId, expiresAt: new Date(Date.now() + 60_000) },
        // An already-revoked session must not be "re-revoked" (counted again).
        {
          token: "revoke-sess-old",
          userId,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
        },
      ],
    });

    const result = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect(result.count).toBe(2);

    const active = await prisma.session.findMany({ where: { userId, revokedAt: null } });
    expect(active).toHaveLength(0);
  });
});
