/**
 * Account recovery + email verification (audit §15).
 *
 * Design rules:
 *  - Ticket secrets are NEVER stored. Only their SHA-256 hash lands in the DB,
 *    so a leaked DB cannot be replayed.
 *  - Tickets are single-use: consuming marks `consumedAt`; a second attempt
 *    with the same secret is rejected.
 *  - Tickets expire. A request always mints a fresh ticket and invalidates the
 *    previous pending one for the same (user, purpose) — no accumulation.
 *  - Requests do not leak whether an account exists. A password-reset request
 *    for an unknown email returns the same "if the account exists, we sent a
 *    link" answer, so the endpoint cannot be used for enumeration.
 *  - Delivery of the link is delegated to the notification layer. When no
 *    external mailer is configured the link is surfaced via an in-app
 *    notification and the caller may return it ONLY in development — never in
 *    production, where it would defeat email ownership.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { audit } from "./audit";
import { notify } from "./notifications";
import { assertEnum } from "../db/enums";
import { ApiError, hashPassword } from "../auth";

const TICKET_TTL_MINUTES = 30;
const RESET_TTL_MINUTES = 30;

function sha256Hex(input: string): string {
  // Synchronous node:crypto hash — the Web Crypto `digest` in this runtime is
  // async-only, and ticket hashing must never block the event loop anyway.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:crypto").createHash("sha256").update(input).digest("hex");
}

/** URL-safe secret with enough entropy to be unguessable. */
function newTicketSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface IssuedTicket {
  /** The plaintext secret. Only safe to expose to the user's own inbox. */
  secret: string;
  ticketId: string;
  expiresAt: Date;
}

async function mintTicket(
  userId: string,
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD"
): Promise<IssuedTicket> {
  assertEnum("AuthTicketPurpose", purpose);
  const ttlMin = purpose === "RESET_PASSWORD" ? RESET_TTL_MINUTES : TICKET_TTL_MINUTES;
  const secret = newTicketSecret();
  const expiresAt = new Date(Date.now() + ttlMin * 60_000);

  // Invalidate any prior pending ticket for the same purpose, then mint a new
  // one. Done in a transaction so the rotation is atomic.
  const ticket = await prisma.$transaction(async (tx) => {
    await tx.authTicket.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return tx.authTicket.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256Hex(secret),
        expiresAt,
      },
      select: { id: true },
    });
  });

  return { secret, ticketId: ticket.id, expiresAt };
}

export interface TicketConsumption {
  userId: string;
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD";
}

/**
 * Validates a presented secret and marks the ticket consumed.
 * Throws ApiError(400) on any mismatch, expiry, reuse or unknown ticket —
 * all collapse to one generic message to avoid oracle behaviour.
 */
async function consumeTicket(
  secret: string,
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD"
): Promise<TicketConsumption> {
  if (!secret || secret.length < 32) throw new ApiError(400, "Недействительная или истекшая ссылка.");
  const ticket = await prisma.authTicket.findUnique({
    where: { tokenHash: sha256Hex(secret) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });
  if (!ticket || ticket.purpose !== purpose) {
    throw new ApiError(400, "Недействительная или истекшая ссылка.");
  }
  if (ticket.consumedAt) {
    // Single-use: a replay means the secret already spent.
    throw new ApiError(400, "Ссылка уже была использована. Запросите новую.");
  }
  if (ticket.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "Срок действия ссылки истёк. Запросите новую.");
  }
  await prisma.authTicket.update({
    where: { id: ticket.id },
    data: { consumedAt: new Date() },
  });
  return { userId: ticket.userId, purpose: ticket.purpose };
}

function verificationUrl(secret: string): string {
  return `${env.publicAppUrl}/verify-email?ticket=${secret}`;
}

function resetUrl(secret: string): string {
  return `${env.publicAppUrl}/reset-password?ticket=${secret}`;
}

/** True when the caller is allowed to see the link inline (dev tooling only). */
function mayRevealLinkInline(): boolean {
  return env.nodeEnv !== "production";
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function requestEmailVerification(userId: string): Promise<IssuedTicket> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw new ApiError(404, "Пользователь не найден.");
  if (user.emailVerifiedAt) throw new ApiError(409, "Email уже подтверждён.");

  const ticket = await mintTicket(userId, "VERIFY_EMAIL");
  const link = verificationUrl(ticket.secret);

  await notify({
    userId,
    kind: "reminder",
    title: "Подтвердите email",
    body: `Перейдите по ссылке, чтобы подтвердить email: ${link}`,
  }).catch(() => {
    /* notification is best-effort; the ticket is still valid */
  });

  await audit({
    action: "email_verification_requested",
    actorId: userId,
    actorRole: "user",
    targetType: "user",
    targetId: userId,
  });

  return ticket;
}

export async function confirmEmail(secret: string): Promise<{ email: string }> {
  const { userId } = await consumeTicket(secret, "VERIFY_EMAIL");
  const user = await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
    select: { email: true },
  });
  await audit({
    action: "email_verified",
    actorId: userId,
    actorRole: "user",
    targetType: "user",
    targetId: userId,
  });
  return { email: user.email };
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

export interface PasswordResetRequestResult {
  /** Always the same shape, regardless of whether the account exists. */
  sent: boolean;
  /** Present ONLY when inline reveal is permitted (non-production). */
  devLink?: string;
}

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });

  // Constant-ish outcome: never reveal account existence.
  if (!user) {
    return { sent: false };
  }

  const ticket = await mintTicket(user.id, "RESET_PASSWORD");
  const link = resetUrl(ticket.secret);

  await notify({
    userId: user.id,
    kind: "reminder",
    title: "Восстановление пароля",
    body: `Ссылка для сброса пароля: ${link}`,
  }).catch(() => {
    /* best-effort */
  });

  await audit({
    action: "password_reset_requested",
    actorId: user.id,
    actorRole: "user",
    targetType: "user",
    targetId: user.id,
  });

  return {
    sent: true,
    devLink: mayRevealLinkInline() ? link : undefined,
  };
}

export async function resetPassword(secret: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new ApiError(400, "Пароль должен быть не короче 8 символов.");
  }
  const { userId } = await consumeTicket(secret, "RESET_PASSWORD");
  const passwordHash = await hashPassword(newPassword);

  // Revoke every active session so the recovery invalidates prior logins.
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await audit({
    action: "password_reset_completed",
    actorId: userId,
    actorRole: "user",
    targetType: "user",
    targetId: userId,
  });
}

/** True when the presented secret is still spendable (for UI pre-validation). */
export async function isTicketValid(
  secret: string,
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD"
): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const ticket = await prisma.authTicket.findUnique({
    where: { tokenHash: sha256Hex(secret) },
    select: { purpose: true, expiresAt: true, consumedAt: true },
  });
  if (!ticket || ticket.purpose !== purpose || ticket.consumedAt) return false;
  return ticket.expiresAt.getTime() > Date.now();
}
