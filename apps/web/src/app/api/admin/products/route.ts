import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { listAdminProducts } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

/** Platform-wide product inventory (spec §37), all statuses included. */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:products", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json({ items: await listAdminProducts(100) });
});
