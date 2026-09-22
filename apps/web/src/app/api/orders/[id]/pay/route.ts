import { apiRoute, readIdempotencyKey, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capturePayment, getPaymentProvider } from "@/lib/domains/payments";
import { notify } from "@/lib/domains/notifications";

export const dynamic = "force-dynamic";

/**
 * Capture payment for an order through the configured payment provider.
 *
 * Money moves only inside the regulated payment partner (spec §25). The app
 * never debits anyone itself; this route asks the partner to charge and then
 * records the partner's authoritative result. Idempotent: a repeated call for
 * an already-paid order returns the recorded status without a second charge.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  if (!rateLimit(`pay:${user.id}`, 10, 60_000)) return tooManyRequests();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.id },
    select: { id: true, buyerId: true, number: true, status: true, totalKopecks: true, currency: true },
  });

  if (order.buyerId !== user.id) {
    return Response.json({ error: "Нет доступа к этому заказу", code: "forbidden" }, { status: 403 });
  }

  if (order.status === "CANCELLED") {
    return Response.json({ error: "Заказ отменён, оплата невозможна", code: "cancelled" }, { status: 409 });
  }

  const result = await capturePayment(order.id);
  // The provider key is resolved server-side; the frontend only learns whether
  // this was a sandbox charge (spec §2: never expose provider identity).
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
    // Frontend must never learn internal provider names (spec §2). Expose only
    // the sandbox flag so the UI can honestly label a non-production charge.
    providerLabel: result.sandbox ? "sandbox" : "partner",
    providerKey: provider.key,
    idempotencyKey: readIdempotencyKey(request),
  });
});
