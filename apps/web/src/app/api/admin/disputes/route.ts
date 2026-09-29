import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { listAdminDisputeQueue } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:disputes", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const queue = await listAdminDisputeQueue(status);
  return Response.json({ disputes: queue });
});
