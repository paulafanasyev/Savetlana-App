export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { requestEmailVerification } from "@/lib/domains/account-recovery";

/**
 * POST /api/auth/verify-email/request
 * Mints a fresh verification ticket for the authenticated user. The link is
 * delivered via notifications; it is only returned inline outside production.
 */
export const POST = apiRoute(async (request: Request) => {
  const ctx = await requireUser(request);
  const ticket = await requestEmailVerification(ctx.user.id);
  return Response.json({
    ok: true,
    expiresAt: ticket.expiresAt.toISOString(),
    // Never expose the secret in a response body in production — it must only
    // ever reach the user's inbox. Dev reveal exists for local testing.
    devTicket: process.env.NODE_ENV === "production" ? undefined : ticket.secret,
  });
});
