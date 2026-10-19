import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { addSavedSearch, labelFor, removeSavedSearch } from "@/lib/domains/saved-searches";
import { cleanParams } from "@/lib/saved-search";

export const dynamic = "force-dynamic";

/**
 * Сохранить или удалить поиск объявлений: обычная форма, после неё «Мои поиски».
 */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`saved-search:${user.id}`, 30, 60 * 60_000)) return tooManyRequests();
  const form = await request.formData();
  const action = String(form.get("action") ?? "add");
  if (action === "remove") {
    const ok = await removeSavedSearch(user.id, String(form.get("id") ?? ""));
    return Response.redirect(new URL(`/classifieds/saved?${ok ? "removed=1" : ""}`, request.url), 303);
  }
  const params = cleanParams({
    vertical: form.get("vertical"),
    dealType: form.get("dealType"),
    cityId: form.get("cityId"),
    q: form.get("q"),
  });
  const result = await addSavedSearch(user.id, params, await labelFor(params));
  return Response.redirect(new URL(`/classifieds/saved?saved=${result}`, request.url), 303);
});
