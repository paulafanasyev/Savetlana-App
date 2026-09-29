export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiRoute } from "@/lib/api-helpers";
import { confirmEmail, isTicketValid } from "@/lib/domains/account-recovery";

/**
 * GET /api/auth/verify-email/confirm?ticket=...
 * Confirms email ownership. Single-use; a replay is rejected.
 */
export const GET = apiRoute(async (request: Request) => {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket") ?? "";
  const { email } = await confirmEmail(ticket);
  return Response.json({ ok: true, email });
});

/** Pre-validation for the UI (shows the right state before submit). */
export const HEAD = apiRoute(async (request: Request) => {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket") ?? "";
  const valid = await isTicketValid(ticket, "VERIFY_EMAIL");
  return Response.json({ valid });
});
