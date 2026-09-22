import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { listAiModelCalls, getAiCallStats } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:ai", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "calls";
  if (view === "stats") {
    return Response.json({ items: await getAiCallStats() });
  }
  return Response.json({ items: await listAiModelCalls(200) });
});
