import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, requireVerifiedSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { payoutIdempotencyKey } from "@/lib/payout-key";
import {
  createConsolidatedPayout,
  sellerSettlementStatement,
} from "@/lib/domains/payments";

export const dynamic = "force-dynamic";

/** Seller settlement statement (spec §26): gross → fees → payout. */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("payouts:read", 20, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const statement = await sellerSettlementStatement(ctx.sellerId);
  return Response.json(statement);
});

/**
 * Requests a consolidated payout of all completed settlements (spec §26).
 * Audit fix: the idempotency key is derived on the server from the exact set
 * of pending settlements, so double clicks, two tabs or retries with different
 * client keys resolve to the same key and the unique Payout.idempotencyKey lets
 * only one of them reserve the money.
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit(`payouts:request:${request.headers.get("x-real-ip") ?? "anon"}`, 5, 60_000)) return tooManyRequests();
  const ctx = await requireVerifiedSeller(request, "запрашивать выплату");

  const pending = await prisma.settlement.findMany({
    where: { sellerId: ctx.sellerId, status: "PENDING", payoutId: null },
    select: { id: true },
  });
  const idempotencyKey = payoutIdempotencyKey(ctx.sellerId, pending.map((s) => s.id));

  const result = await createConsolidatedPayout({
    sellerId: ctx.sellerId,
    actorId: ctx.user.id,
    idempotencyKey,
  });

  // HTML form submissions go back to the statement page instead of raw JSON.
  const contentType = request.headers.get("content-type") ?? "";
  const isForm =
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data");
  if (isForm) {
    const flag = result.status === "NOTHING_TO_PAYOUT" ? "nothing" : result.status.toLowerCase();
    return new Response(null, { status: 303, headers: { Location: `/seller/payouts?payout=${encodeURIComponent(flag)}` } });
  }

  return Response.json(result, {
    status: result.status === "NOTHING_TO_PAYOUT" ? 200 : 201,
  });
});
