import { apiRoute } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { sellerTodoItems } from "@/lib/domains/seller-badges";

export const dynamic = "force-dynamic";

/** «Что сделать сегодня» для обновления без перезагрузки: только подписи и ссылки, без содержимого. */
export const GET = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const items = await sellerTodoItems(sellerId, user.id);
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
});
