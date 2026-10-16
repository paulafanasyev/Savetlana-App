import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { closeClassified, reopenClassified } from "@/lib/domains/classified-close";
import { backPath, closeOutcome } from "@/lib/ad-status-rules";

export const dynamic = "force-dynamic";

/**
 * Снять объявление с публикации (?do=close, с &reason=deal если сделка состоялась)
 * или вернуть его (?do=reopen). Обычная форма, после неё возврат обратно с итогом в адресе.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`classified-close:${user.id}`, 30, 60_000)) return tooManyRequests();
  const url = new URL(request.url);
  const action = url.searchParams.get("do") === "reopen" ? "reopen" : "close";
  const back = new URL(backPath(params.id, url.searchParams.get("back")), request.url);
  try {
    if (action === "close") {
      const outcome = closeOutcome(url.searchParams.get("reason"));
      await closeClassified(params.id, user.id, outcome);
      back.searchParams.set("closed", outcome === "deal" ? "deal" : "1");
    } else {
      const status = await reopenClassified(params.id, user.id);
      back.searchParams.set("reopened", status === "PUBLISHED" ? "1" : "review");
    }
  } catch {
    // Причину не раскрываем в адресе: на странице честное общее сообщение.
    back.searchParams.set("status", "fail");
  }
  return Response.redirect(back, 303);
});
