import { apiRoute } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { sellerBadges } from "@/lib/domains/seller-badges";

export const dynamic = "force-dynamic";

/** Счётчики для меню кабинета: только числа, без содержимого заказов и сообщений. */
export const GET = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const badges = await sellerBadges(sellerId, user.id);
  return Response.json(badges, { headers: { "Cache-Control": "no-store" } });
});
