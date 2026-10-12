import { apiRoute } from "@/lib/api-helpers";
import { TbankPaymentProvider, mapTbankStatus, orderIdFromAttempt } from "@/lib/domains/tbank";
import { applyVerifiedPayment } from "@/lib/domains/payment-webhooks";

export const dynamic = "force-dynamic";

/**
 * Уведомления Т-Банка. Проверяем подпись Token, затем перезапрашиваем статус
 * через GetState — решение принимается только по ответу API банка.
 * Т-Банк ждёт ответ «OK» (HTTP 200), иначе повторяет уведомление.
 */
export const POST = apiRoute(async (request) => {
  const provider = new TbankPaymentProvider();
  if (!provider.available) return new Response("not configured", { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !provider.verifyNotification(body)) return new Response("bad token", { status: 401 });

  const paymentId = String(body.PaymentId ?? "");
  if (!/^\d{1,20}$/.test(paymentId)) return new Response("bad payment", { status: 400 });

  const live = await provider.getPayment(paymentId);
  await applyVerifiedPayment({
    providerKey: provider.key,
    providerRef: paymentId,
    orderId: live.orderId ?? orderIdFromAttempt(typeof body.OrderId === "string" ? body.OrderId : undefined),
    status: mapTbankStatus(live.status),
    rawStatus: live.status || "UNKNOWN",
    amountKopecks: live.amountKopecks,
  });
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
});
