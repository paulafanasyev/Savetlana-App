import { apiRoute, readIdempotencyKey, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capturePayment, getPaymentProvider, getPaymentProviderByKey, type PaymentMethod } from "@/lib/domains/payments";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

/**
 * Capture payment for an order through the configured payment provider.
 * Idempotent: a repeated call for an already-paid order returns the recorded
 * status without a second charge. Audit fix: the provider is called only for
 * orders that are actually awaiting payment.
 *
 * Заказ, который проверка риска при оформлении пометила BLOCKED (сумма не совпала
 * с ценой в каталоге), оплатить нельзя.
 *
 * Двойная оплата: если предыдущий платёж (например, картой) банк уже провёл, а
 * уведомление ещё не дошло, новый платёж (например, через СБП) не создаём.
 *
 * Тело (необязательно): { method: "card" | "sbp" }. Ответ содержит confirmationUrl —
 * страницу банка или ссылку СБП. Заказ становится оплаченным по уведомлению банка
 * (/api/webhooks/yookassa | tbank | sber | alfa) после перезапроса статуса.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  if (!rateLimit(`pay:${user.id}`, 10, 60_000)) return tooManyRequests();

  const body = (await request.json().catch(() => ({}))) as { method?: unknown } | null;
  const method: PaymentMethod = body && body.method === "sbp" ? "sbp" : "card";

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.id },
    select: {
      id: true,
      buyerId: true,
      groupId: true,
      number: true,
      status: true,
      totalKopecks: true,
      currency: true,
      payment: { select: { status: true, provider: true, providerRef: true, sandbox: true } },
      sellerProfile: { select: { userId: true } },
    },
  });

  if (order.buyerId !== user.id) {
    return Response.json({ error: "Нет доступа к этому заказу", code: "forbidden" }, { status: 403 });
  }
  if (order.status !== "PAYMENT_PENDING" && order.payment?.status !== "SUCCEEDED") {
    return Response.json({ error: "Оплата возможна только для заказа, ожидающего оплаты", code: "payment_not_pending" }, { status: 409 });
  }

  const wasPaid = order.payment?.status === "SUCCEEDED";
  if (!wasPaid && order.groupId) {
    const risk = await prisma.riskEvent.findFirst({
      where: { actorType: "order", actorId: order.groupId },
      orderBy: { createdAt: "desc" },
      select: { level: true },
    });
    if (risk?.level === "BLOCKED") {
      return Response.json(
        {
          error: "Оплата этого заказа приостановлена: сумма в заказе не совпала с ценой в каталоге. Оформите заказ заново или напишите в поддержку.",
          code: "risk_blocked",
        },
        { status: 409 },
      );
    }
  }

  // Предыдущий платёж ждёт подтверждения: спрашиваем банк, не прошёл ли он уже.
  if (!wasPaid && order.payment?.status === "PENDING" && order.payment.providerRef && !order.payment.sandbox) {
    const previous = getPaymentProviderByKey(order.payment.provider);
    const live = previous ? await previous.getStatus(order.payment.providerRef).catch(() => null) : null;
    if (live?.status === "SUCCEEDED") {
      return Response.json(
        {
          error: "Оплата уже прошла, ждём подтверждения банка. Обновите страницу заказа через минуту, платить ещё раз не нужно.",
          code: "payment_in_progress",
        },
        { status: 409 },
      );
    }
  }

  const result = await capturePayment(order.id, method);
  const provider = getPaymentProvider();

  if (result.status === "SUCCEEDED") {
    await notify({
      userId: user.id,
      kind: "order_status",
      title: `Заказ ${order.number} оплачен`,
      body: result.sandbox
        ? "Оплата проведена в песочнице платёжного партнёра (sandbox)."
        : "Оплата подтверждена платёжным партнёром. Продавец приступит к сборке.",
      url: `/orders/${order.id}`,
    });
    // Продавцу — один раз, когда оплата прошла именно сейчас.
    if (!wasPaid && order.sellerProfile?.userId) {
      await notify({
        userId: order.sellerProfile.userId,
        kind: "order_status",
        title: `Новый оплаченный заказ ${order.number}`,
        body: result.sandbox
          ? "Тестовая оплата (sandbox). Подтвердите заказ и передайте в доставку."
          : "Покупатель оплатил заказ. Подтвердите его и передайте в доставку.",
        url: `/seller/orders`,
      }).catch(() => undefined);
    }
  }

  return Response.json({
    orderId: order.id,
    status: result.status,
    sandbox: result.sandbox,
    providerRef: result.providerRef,
    providerLabel: result.sandbox ? "sandbox" : "partner",
    providerKey: provider.key,
    method,
    // Страница оплаты банка или ссылка СБП (только https-адрес партнёра).
    confirmationUrl: result.confirmationUrl && /^https:\/\//.test(result.confirmationUrl) ? result.confirmationUrl : null,
    idempotencyKey: readIdempotencyKey(request),
  });
});
