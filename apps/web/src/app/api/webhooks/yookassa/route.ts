import { apiRoute } from "@/lib/api-helpers";
import { YooKassaPaymentProvider, mapYooStatus, valueToKopecks } from "@/lib/domains/yookassa";
import { applyVerifiedPayment } from "@/lib/domains/payment-webhooks";

export const dynamic = "force-dynamic";

/**
 * Уведомления ЮKassa (payment.succeeded / payment.canceled).
 *
 * Уведомления ЮKassa не подписаны, поэтому телу запроса мы не верим вообще:
 * берём из него только id платежа и перезапрашиваем платёж через API ЮKassa
 * с нашим ключом. Дальше — общая проверка: сумма, заказ, повторы, двойная оплата.
 */
export const POST = apiRoute(async (request) => {
  const provider = new YooKassaPaymentProvider();
  if (!provider.available) {
    return Response.json({ error: "ЮKassa не настроена", code: "not_configured" }, { status: 503 });
  }

  const raw = (await request.json().catch(() => null)) as { object?: { id?: string } } | null;
  const paymentId = raw?.object?.id;
  if (!paymentId || typeof paymentId !== "string" || !/^[\w-]{8,64}$/.test(paymentId)) {
    return Response.json({ error: "Некорректное уведомление", code: "bad_event" }, { status: 400 });
  }

  // Источник правды — API ЮKassa, а не тело уведомления.
  const live = await provider.getPayment(paymentId);
  const amount = live.amount && (live.amount.currency ?? "RUB") === "RUB" ? valueToKopecks(live.amount.value) : null;
  const result = await applyVerifiedPayment({
    providerKey: provider.key,
    providerRef: live.id,
    orderId: live.metadata?.order_id,
    status: mapYooStatus(live.status),
    rawStatus: live.status,
    amountKopecks: amount !== null && Number.isFinite(amount) ? amount : null,
  });
  return Response.json({ ok: true, result });
});
