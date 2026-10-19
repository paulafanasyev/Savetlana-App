import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { editClassified } from "@/lib/domains/classified-edit";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/**
 * Сохранение правки объявления: обычная форма. Успех ведёт на объявление
 * (или в «Мои объявления», если правку смотрит модератор), ошибка возвращает к форме.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`classified-edit:${user.id}`, 20, 60 * 60_000)) return tooManyRequests();
  const id = params.id;
  const form = await request.formData();
  try {
    const status = await editClassified(id, user.id, {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      priceRub: form.get("priceRub"),
      get: (name) => form.get(name),
    });
    const target = status === "PUBLISHED" ? `/classifieds/${encodeURIComponent(id)}?edited=1` : "/classifieds/my?edited=review";
    return Response.redirect(new URL(target, request.url), 303);
  } catch (e) {
    if (!(e instanceof UserFacingError)) throw e;
    const back = new URL(`/classifieds/${encodeURIComponent(id)}/edit`, request.url);
    back.searchParams.set("error", e.message.slice(0, 300));
    return Response.redirect(back, 303);
  }
});
