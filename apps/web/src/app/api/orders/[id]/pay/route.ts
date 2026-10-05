import { apiRoute, readIdempotencyKey, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capturePayment, getPaymentProvider } from "@/lib/domains/payments";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

/**
 * Capture payment for an order through the configured payment provider.
 * Idempotent: a repeated call for an already-paid order returns the recorded
 * status without a second charge. Audit fix: the provider is called only for
 * orders that are actually awaiting payment.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  if (!rateLimit(`pay:${user.id}`, 10, 60_000)) return tooManyRequests();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.id },
    select: { id: true, buyerId: true, number: true, status: true, totalKopecks: true, currency: true, payment: { select: { status: true } } },
  });

  if (order.buyerId !== user.id) {
    return Response.json({ error: "Нет доступа к этому заказу", code: "forbidden" }, { status: 403 });
  }
  if (order.status !== "PAYMENT_PENDING" && order.payment?.status !== "SUCCEEDED") {
    return Response.json({ error: "Оплата возможна только для заказа, ожидающего оплаты", code: "payment_not_pending" }, { status: 409 });
  }

  const result = await capturePayment(order.id);
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
  }

  return Response.json({
    orderId: order.id,
    status: result.status,
    sandbox: result.sandbox,
    providerRef: result.providerRef,
    providerLabel: result.sandbox ? "sandbox" : "partner",
    providerKey: provider.key,
    idempotencyKey: readIdempotencyKey(request),
  });
});
