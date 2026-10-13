import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { demoCatalogStatus, loadDemoCatalog, removeDemoCatalog } from "@/lib/domains/demo-catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = apiRoute(async (request) => {
  await requireAdmin(request);
  return Response.json(await demoCatalogStatus());
});

export const POST = apiRoute(async (request) => {
  await requireAdmin(request);
  const body = await jsonBody<{ action?: string }>(request);
  if (body.action === "load") return Response.json(await loadDemoCatalog());
  if (body.action === "remove") return Response.json(await removeDemoCatalog());
  return Response.json({ error: "Неизвестное действие", code: "bad_action" }, { status: 400 });
});
