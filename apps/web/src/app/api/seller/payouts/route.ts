import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, requireVerifiedSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { payoutIdempotencyKey } from "@/lib/payout-key";
import { createConsolidatedPayout, sellerSettlementStatement } from "@/lib/domains/payments";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("payouts:read", 20, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  return Response.json(await sellerSettlementStatement(ctx.sellerId));
});

export const POST = apiRoute(async (request) => {
  if (!rateLimit(`payouts:request:${request.headers.get("x-real-ip") ?? "anon"}`, 5, 60_000)) return tooManyRequests();
  const ctx = await requireVerifiedSeller(request, "запрашивать выплату");
  const pending = await prisma.settlement.findMany({
    where: { sellerId: ctx.sellerId, status: "PENDING", payoutId: null },
    select: { id: true, order: { select: { status: true } } },
  });
  // Деньги продавцу — только после доставки заказа покупателю.
  const notDelivered = pending.filter((row) => !["DELIVERED", "COMPLETED"].includes(row.order.status));
  const contentType = request.headers.get("content-type") ?? "";
  const isForm = !contentType.startsWith("application/json");
  if (notDelivered.length) {
    if (isForm) return new Response(null, { status: 303, headers: { Location: "/seller/payouts?payout=delivery_required" } });
    return Response.json({ error: "Выплата доступна после доставки всех заказов", code: "delivery_required" }, { status: 409 });
  }
  const result = await createConsolidatedPayout({ sellerId: ctx.sellerId, actorId: ctx.user.id, idempotencyKey: payoutIdempotencyKey(ctx.sellerId, pending.map((row) => row.id)) });
  if (isForm) return new Response(null, { status: 303, headers: { Location: `/seller/payouts?payout=${encodeURIComponent(result.status.toLowerCase())}` } });
  return Response.json(result, { status: result.status === "NOTHING_TO_PAYOUT" ? 200 : 201 });
});
