import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionOrder } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

/** Покупатель отменяет только неоплаченный заказ. Оплаченный идёт через возврат или спор. */
const CANCELLABLE = ["CREATED", "PAYMENT_PENDING"];

export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const order = await prisma.order.findFirst({ where: { id: params.id, buyerId: user.id }, select: { status: true } });
  if (!order) return Response.json({ error: "Заказ не найден", code: "not_found" }, { status: 404 });
  if (!CANCELLABLE.includes(order.status)) {
    return Response.json(
      { error: "Оплаченный заказ нельзя просто отменить: оформите возврат или откройте спор, тогда деньги вернутся.", code: "paid_order" },
      { status: 409 }
    );
  }
  const result = await transitionOrder({
    orderId: params.id,
    to: "CANCELLED",
    note: "отмена покупателем",
    actorId: user.id,
    actorRole: "buyer",
    actingUserId: user.id,
  });
  if (!result.ok) {
    return Response.json({ error: "Не удалось отменить заказ", code: "bad_transition" }, { status: 409 });
  }
  await notify({
    userId: user.id,
    kind: "order_status",
    title: `Заказ ${result.order.number} отменён`,
    body: "Заказ отменён до оплаты, деньги не списывались.",
    url: `/orders/${result.order.id}`,
  });
  return Response.json({ ok: true, status: result.order.status });
});
