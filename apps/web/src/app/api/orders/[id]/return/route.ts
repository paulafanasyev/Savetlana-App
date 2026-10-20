import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionOrder } from "@/lib/domains/orders";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

const REASONS = ["ITEM_NOT_AS_DESCRIBED", "ITEM_DAMAGED", "WRONG_ITEM", "NO_LONGER_NEEDED"];

/** Отказ от товара надлежащего качества при дистанционной покупке: 7 дней после получения (ст. 26.1 ЗоЗПП). */
const NO_LONGER_NEEDED_DAYS = 7;

/**
 * Покупатель просит вернуть товар. Деньги возвращаются, когда продавец
 * получит товар обратно (или по решению площадки в споре), а не в момент
 * запроса: иначе можно было бы получить деньги и оставить товар себе.
 *
 * «Не подошёл» принимается 7 дней после доставки. Претензия к качеству (брак, не тот
 * товар, не соответствует описанию) по закону можно заявить и позже, её не ограничиваем.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ reason?: string; comment?: string }>(request);
  if (!body.reason || !REASONS.includes(body.reason)) {
    throw new ApiError(400, "Укажите причину возврата");
  }

  if (body.reason === "NO_LONGER_NEEDED") {
    const delivered = await prisma.orderHistory.findFirst({
      where: { orderId: params.id, toStatus: "DELIVERED", order: { buyerId: user.id } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (delivered && Date.now() - delivered.createdAt.getTime() > NO_LONGER_NEEDED_DAYS * 86_400_000) {
      throw new ApiError(
        409,
        `Вернуть товар, который просто не подошёл, можно в течение ${NO_LONGER_NEEDED_DAYS} дней после получения. Если у товара есть недостаток или пришло не то, выберите эту причину: такие претензии принимаются и позже.`,
        "return_window_closed",
      );
    }
  }

  const result = await transitionOrder({
    orderId: params.id,
    to: "RETURN_REQUESTED",
    note: body.comment?.slice(0, 1000) ?? `возврат: ${body.reason}`,
    actorId: user.id,
    actorRole: "buyer",
    actingUserId: user.id,
  });
  if (!result.ok) {
    return Response.json(
      { error: `Невозможно оформить возврат: ${result.note}`, code: "bad_transition" },
      { status: 409 }
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { sellerProfile: { select: { userId: true } } },
  });
  if (order?.sellerProfile?.userId) {
    await notify({
      userId: order.sellerProfile.userId,
      kind: "order_status",
      title: `Покупатель просит возврат по заказу ${result.order.number}`,
      body: "Откройте заказ в кабинете продавца: примите возврат или объясните, почему он невозможен.",
      url: "/seller/orders",
    });
  }

  await notify({
    userId: user.id,
    kind: "order_status",
    title: `Оформлен возврат по заказу ${result.order.number}`,
    body: "Запрос передан продавцу. Когда он примет возврат, отправьте товар обратно: деньги вернутся, как только продавец его получит. Если продавец не отвечает или отказал, откройте спор на странице заказа.",
    url: `/orders/${result.order.id}`,
  });
  return Response.json({ ok: true, status: result.order.status });
});
