import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { listAdminUsers, setUserBlocked } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:users", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json({ items: await listAdminUsers(100) });
});

export const POST = apiRoute(async (request) => {
  if (!rateLimit("admin:user-action", 10, 60_000)) return tooManyRequests();
  const ctx = await requireAdmin(request);
  const body = await jsonBody<{
    userId?: string;
    blocked?: boolean;
  }>(request);

  if (!body.userId) throw new ApiError(400, "Укажите userId");
  if (typeof body.blocked !== "boolean") throw new ApiError(400, "Укажите blocked");

  const result = await setUserBlocked(body.userId, body.blocked, ctx.user.id);
  return Response.json(result);
});
