import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { listAdminPayments } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

/** Admin payments & payouts ledger (spec §37). */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:payments", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json(await listAdminPayments(100));
});
