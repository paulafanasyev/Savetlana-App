import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { toggleAdFavorite } from "@/lib/domains/ad-favorites";

export const dynamic = "force-dynamic";

/**
 * Добавить или убрать объявление из избранного: обычная форма.
 * ?back=favorites возвращает в «Избранное», иначе на страницу объявления.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`ad-favorite:${user.id}`, 120, 60 * 60_000)) return tooManyRequests();
  const id = params.id;
  const result = await toggleAdFavorite(user.id, id);
  const back = new URL(request.url).searchParams.get("back");
  const target =
    back === "favorites"
      ? "/favorites#ads"
      : `/classifieds/${encodeURIComponent(id)}?fav=${result}`;
  return Response.redirect(new URL(target, request.url), 303);
});
