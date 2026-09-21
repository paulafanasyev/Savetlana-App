import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { transitionOrder } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const result = await transitionOrder({
    orderId: params.id,
    to: "CANCELLED",
    note: "отмена покупателем",
    actorId: user.id,
    actorRole: "buyer",
    actingUserId: user.id,
  });
  if (!result.ok) {
    return Response.json(
      { error: `Не удалось отменить заказ: ${result.note}`, code: "bad_transition" },
      { status: 409 }
    );
  }
  await notify({
    userId: user.id,
    kind: "order_status",
    title: `Заказ ${result.order.number} отменён`,
    body: "Деньги вернутся по правилам платёжного партнёра.",
    url: `/orders/${result.order.id}`,
  });
  return Response.json({ ok: true, status: result.order.status });
});
