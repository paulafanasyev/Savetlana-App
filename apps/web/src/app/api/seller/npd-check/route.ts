import { apiRoute } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { verifySellerNpd } from "@/lib/domains/seller-verification";

export const dynamic = "force-dynamic";

/** Повторная проверка статуса самозанятого в ФНС (не чаще раза в минуту). */
export const POST = apiRoute(async (request) => {
  const { user, sellerId } = await requireSeller(request);
  return Response.json(await verifySellerNpd(sellerId, user.id));
});
