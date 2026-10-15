import { apiRoute } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { markAllOtherRead } from "@/lib/domains/notification-center";

export const dynamic = "force-dynamic";

/**
 * Form-friendly mark-all-read: mutates, then redirects back to the
 * notification center (the sentinel redirect is handled by apiRoute).
 * Переписку не трогает: она помечается прочитанной, когда её открыли.
 */
export const POST = apiRoute(async (request) => {
  const ctx = await requireUser(request);
  await markAllOtherRead(ctx.user.id);
  return Response.redirect(new URL("/notifications", request.url).toString(), 303);
});
