import { apiRoute } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/domains/audit";
import { markOrderPaid } from "@/lib/domains/payments";
import { canTransition } from "@/lib/domains/orders";
import { YooKassaPaymentProvider, mapYooStatus, valueToKopecks } from "@/lib/domains/yookassa";

export const dynamic = "force-dynamic";

/**
 * Уведомления ЮKassa (payment.succeeded / payment.canceled).
 *
 * Уведомления ЮKassa не подписаны, поэтому телу запроса мы не верим вообще:
 * берём из него только id платежа и перезапрашиваем платёж через API ЮKassa
 * с нашим ключом. Заказ помечается оплаченным, только если API подтвердил
 * succeeded, сумма совпала с заказом и платёж принадлежит этому заказу.
 * Повторная доставка того же события подтверждается, но не применяется дважды.
 */
export const POST = apiRoute(async (request) => {
  const provider = new YooKassaPaymentProvider();
  if (!provider.available) {
    return Response.json({ error: "ЮKassa не настроена", code: "not_configured" }, { status: 503 });
  }

  const raw = (await request.json().catch(() => null)) as {
    event?: string;
    object?: { id?: string };
  } | null;
  const paymentId = raw?.object?.id;
  if (!paymentId || typeof paymentId !== "string" || !/^[\w-]{8,64}$/.test(paymentId)) {
    return Response.json({ error: "Некорректное уведомление", code: "bad_event" }, { status: 400 });
  }

  // Источник правды — API ЮKassa, а не тело уведомления.
  const live = await provider.getPayment(paymentId);
  const status = mapYooStatus(live.status);
  const orderId = live.metadata?.order_id;
  if (!orderId) return Response.json({ ok: true, ignored: "no_order" });

  const eventId = `yookassa:${live.id}:${live.status}`;
  const seen = await prisma.outboxMessage.findUnique({ where: { id: eventId } }).catch(() => null);
  if (seen) return Response.json({ ok: true, deduplicated: true });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, totalKopecks: true, payment: { select: { id: true, providerRef: true } } },
  });
  const payment = order?.payment;
  if (!order || !payment || payment.providerRef !== live.id) {
    // Платёж не наш или не к этому заказу — ничего не меняем.
    return Response.json({ ok: true, ignored: "unknown_payment" });
  }

  await prisma.outboxMessage.create({
    data: {
      id: eventId,
      aggregate: "payment-webhook",
      aggregateId: order.id,
      type: `YOOKASSA_${String(raw?.event ?? live.status).toUpperCase().replace(/[^A-Z_.]/g, "")}`,
      payload: JSON.stringify({ paymentId: live.id, status: live.status, amount: live.amount }),
    },
  });

  if (status === "SUCCEEDED") {
    const paid = live.amount ? valueToKopecks(live.amount.value) : NaN;
    if (paid !== order.totalKopecks || (live.amount?.currency ?? "RUB") !== "RUB") {
      await audit({
        actorRole: "system",
        action: "payment.webhook.amount_mismatch",
        targetType: "Order",
        targetId: order.id,
        after: { paymentId: live.id, paid, expected: order.totalKopecks },
      }).catch(() => undefined);
      return Response.json({ ok: true, ignored: "amount_mismatch" });
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCEEDED", errorMessage: null, processedAt: new Date() },
    });
    if (canTransition(order.status, "PAID")) {
      await markOrderPaid(order.id, false);
    }
    await audit({
      actorRole: "system",
      action: "payment.webhook.captured",
      targetType: "Order",
      targetId: order.id,
      after: { provider: "yookassa", providerRef: live.id },
    }).catch(() => undefined);
  } else if (status === "FAILED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", errorMessage: "Платёж отменён в ЮKassa", processedAt: new Date() },
    });
  }

  return Response.json({ ok: true });
});
