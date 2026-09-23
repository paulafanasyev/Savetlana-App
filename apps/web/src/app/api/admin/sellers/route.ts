import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { listAdminSellers } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

/** Admin sellers directory (spec §37). */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:sellers", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json({ items: await listAdminSellers(100) });
});
