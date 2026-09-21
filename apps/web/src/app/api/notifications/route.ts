import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { listNotifications, markAllRead, unreadCount } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const items = await listNotifications(user.id, {
    unreadOnly: url.searchParams.get("unreadOnly") === "1",
    limit: Number(url.searchParams.get("limit") ?? 40),
  });
  const unread = await unreadCount(user.id);
  return Response.json({ items, unread });
});

export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  await markAllRead(user.id);
  return Response.json({ ok: true });
});
