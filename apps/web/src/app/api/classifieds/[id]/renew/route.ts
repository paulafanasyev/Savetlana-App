import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { renewClassified } from "@/lib/domains/classified-renew";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { backPath } from "@/lib/ad-status-rules";

export const dynamic = "force-dynamic";

/**
 * Продление объявления: обычная форма из «Моих объявлений» или со страницы
 * объявления (?back=ad), после неё возврат туда же.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`classified-renew:${user.id}`, 30, 60_000)) return tooManyRequests();
  const back = new URL(backPath(params.id, new URL(request.url).searchParams.get("back")), request.url);
  try {
    await renewClassified(params.id, user.id);
    back.searchParams.set("renewed", "1");
  } catch (e) {
    if (!(e instanceof UserFacingError)) throw e;
    back.searchParams.set("renew", "fail");
  }
  return Response.redirect(back, 303);
});
