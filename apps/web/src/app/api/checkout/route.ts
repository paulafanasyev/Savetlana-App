import { apiRoute, jsonBody, readIdempotencyKey, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOrdersFromCart, type DeliveryChoice } from "@/lib/domains/orders";
import { getCartView } from "@/lib/domains/cart";
import { evaluateOrderRisk } from "@/lib/domains/risk";
import { notify } from "@/lib/domains/notifications";
import { rateLimit } from "@/lib/api-helpers";
import { generateOrderNumber } from "@/lib/utils";
import { isDeliveryMethod } from "@/lib/delivery-options";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  if (!rateLimit(`checkout:${user.id}`, 10, 60_000)) return tooManyRequests();

  const body = await jsonBody<{
    idempotencyKey?: string;
    city?: string;
    street?: string;
    house?: string;
    apartment?: string;
    zip?: string;
    recipientName?: string;
    phone?: string;
    deliveryBySeller?: Record<string, { method?: string }>;
  }>(request);

  const clientKey = body.idempotencyKey ?? readIdempotencyKey(request);
  if (clientKey !== undefined && (typeof clientKey !== "string" || clientKey.length === 0 || clientKey.length > 128)) {
    return Response.json({ error: "Некорректный ключ идемпотентности", code: "bad_idempotency_key" }, { status: 400 });
  }
  if (clientKey) {
    // Audit fix: an idempotency key is scoped to its buyer (IDOR via replay).
    const existing = await prisma.orderGroup.findUnique({
      where: { idempotencyKey: clientKey },
      select: { buyerId: true },
    });
    if (existing && existing.buyerId !== user.id) {
      return Response.json(
        { error: "Этот ключ оформления уже использован. Обновите страницу и попробуйте снова.", code: "idempotency_conflict" },
        { status: 409 },
      );
    }
  }

  const view = await getCartView(user.id);
  if (view.lines.length === 0) {
    return Response.json({ error: "Корзина пуста", code: "empty_cart" }, { status: 400 });
  }

  // Доставка по каждому продавцу. Цену клиенту не доверяем: сервер берёт её из тарифа.
  const sellerIds = new Set(view.lines.map((l) => l.sellerId));
  const deliveryBySeller: Record<string, DeliveryChoice> = {};
  for (const [sellerId, choice] of Object.entries(body.deliveryBySeller ?? {})) {
    if (!sellerIds.has(sellerId)) continue;
    if (!isDeliveryMethod(choice?.method)) {
      return Response.json({ error: "Выбранный способ доставки недоступен", code: "bad_delivery" }, { status: 400 });
    }
    deliveryBySeller[sellerId] = { method: choice.method };
  }
  const needsAddress = Object.values(deliveryBySeller).some((c) => c.method === "SELLER");
  if (needsAddress && (!body.city?.trim() || !body.street?.trim() || !body.house?.trim())) {
    return Response.json({ error: "Для доставки укажите город, улицу и дом", code: "address_required" }, { status: 400 });
  }

  const idempotencyKey = clientKey ?? generateOrderNumber();
  const created = await createOrdersFromCart({
    buyerId: user.id,
    idempotencyKey,
    deliveryAddress: {
      city: body.city,
      street: body.street,
      house: body.house,
      apartment: body.apartment,
      zip: body.zip,
      recipientName: body.recipientName,
      phone: body.phone,
    },
    deliveryBySeller,
  });

  // Risk screen runs after creation, before any money moves (spec §27).
  const risk = await evaluateOrderRisk(created.groupId).catch(() => null);
  if (risk && (risk.level === "REVIEW" || risk.level === "BLOCKED")) {
    await notify({
      userId: user.id,
      kind: "order_status",
      title: "Заказ отправлен на дополнительную проверку",
      body: risk.explanation ?? "Платёж будет принят после проверочных процедур.",
      url: `/orders`,
    });
  }

  return Response.json({
    groupId: created.groupId,
    orders: created.orders.map((o) => ({
      id: o.id,
      number: o.number,
      sellerId: o.sellerId,
      totalKopecks: o.totalKopecks,
      deliveryKopecks: o.deliveryKopecks ?? 0,
      itemsCount: o.itemsCount,
      status: "PAYMENT_PENDING",
    })),
    // Every line whose price moved since it was added is reported by name (P0 fix).
    priceChanges: view.lines
      .filter((l) => l.priceChanged)
      .map((l) => ({
        title: l.title,
        snapshotKopecks: l.priceSnapshotKopecks,
        liveKopecks: l.priceLiveKopecks,
        chargedKopecks: l.priceKopecks,
      })),
    riskLevel: risk?.level ?? "LOW",
    riskExplanation: risk?.explanation ?? null,
  });
});
