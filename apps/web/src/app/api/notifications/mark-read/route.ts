import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { markAllRead } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

/**
 * Form-friendly mark-all-read: mutates, then redirects back to the
 * notification center (the sentinel redirect is handled by apiRoute).
 */
export const POST = apiRoute(async (request) => {
  const ctx = await requireUser(request);
  await markAllRead(ctx.user.id);
  return Response.redirect(new URL("/notifications", request.url).toString(), 303);
});
