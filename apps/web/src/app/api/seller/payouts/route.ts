import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, requireVerifiedSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { payoutIdempotencyKey } from "@/lib/payout-key";
import { getPayoutProvider, sellerSettlementStatement } from "@/lib/domains/payments";
import { DELIVERED_ORDER_STATUSES, payoutDeliveredSettlements } from "@/lib/domains/seller-payouts";
import { isLiveDeployment } from "@/lib/live-mode";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("payouts:read", 20, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  return Response.json(await sellerSettlementStatement(ctx.sellerId));
});

export const POST = apiRoute(async (request) => {
  if (!rateLimit(`payouts:request:${request.headers.get("x-real-ip") ?? "anon"}`, 5, 60_000)) return tooManyRequests();
  const ctx = await requireVerifiedSeller(request, "запрашивать выплату");
  const contentType = request.headers.get("content-type") ?? "";
  const isForm = !contentType.startsWith("application/json");
  const reply = (code: string, status: number, error?: string, extra = "") =>
    isForm
      ? new Response(null, { status: 303, headers: { Location: `/seller/payouts?payout=${encodeURIComponent(code)}${extra}` } })
      : Response.json(error ? { error, code } : { code }, { status });

  // На боевом сайте без банка-партнёра выплату не изображаем: деньги бы не ушли.
  if (getPayoutProvider().sandbox && isLiveDeployment()) {
    return reply("bank_required", 409, "Выплаты включатся после подключения банка-партнёра");
  }

  const pending = await prisma.settlement.findMany({
    where: { sellerId: ctx.sellerId, status: "PENDING", payoutId: null },
    select: { id: true, order: { select: { status: true } } },
  });
  const ready = pending.filter((row) => DELIVERED_ORDER_STATUSES.includes(row.order.status));
  if (ready.length === 0) {
    return pending.length
      ? reply("delivery_required", 409, "Выплата станет доступна после доставки заказа")
      : reply("nothing_to_payout", 200);
  }
  const result = await payoutDeliveredSettlements({
    sellerId: ctx.sellerId,
    actorId: ctx.user.id,
    idempotencyKey: payoutIdempotencyKey(ctx.sellerId, ready.map((row) => row.id)),
  });
  if (isForm) return reply(result.status.toLowerCase(), 201, undefined, result.sandbox ? "&test=1" : "");
  return Response.json(result, { status: result.status === "NOTHING_TO_PAYOUT" ? 200 : 201 });
});
