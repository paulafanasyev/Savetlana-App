import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { listAdminOrders } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:orders", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json({ items: await listAdminOrders(100) });
});
