import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { buyerTodoItems } from "@/lib/domains/buyer-todo-data";

export const dynamic = "force-dynamic";

/** Дела покупателя по заказам для блока на странице «Мои заказы»: только подписи и ссылки. */
export const GET = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const items = await buyerTodoItems(user.id);
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
});
