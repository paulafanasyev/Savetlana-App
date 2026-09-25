import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, requireVerifiedSeller } from "@/lib/auth";
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
 * The disbursement itself is executed by the payment partner — the platform
 * only records the result. Idempotent on the client's idempotency key.
 * Payout is a financial action, so the verification machine is enforced (P0).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("payouts:request", 5, 60_000)) return tooManyRequests();
  const ctx = await requireVerifiedSeller(request, "запрашивать выплату");

  const url = new URL(request.url);
  const contentType = request.headers.get("content-type") ?? "";
  let idempotencyKey =
    request.headers.get("Idempotency-Key") ||
    url.searchParams.get("idempotencyKey") ||
    "";
  // HTML forms post as urlencoded or multipart — accept both so the key the
  // browser submits is honoured instead of being replaced by a fresh one
  // (a double-click would otherwise generate two keys and two payouts).
  const isForm =
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data");
  if (!idempotencyKey && isForm) {
    const form = await request.formData();
    idempotencyKey = (form.get("idempotencyKey") as string) || "";
  }
  if (!idempotencyKey) {
    idempotencyKey = `payout:${ctx.sellerId}:${Date.now()}`;
  }

  const result = await createConsolidatedPayout({
    sellerId: ctx.sellerId,
    actorId: ctx.user.id,
    idempotencyKey,
  });

  return Response.json(result, {
    status: result.status === "NOTHING_TO_PAYOUT" ? 200 : 201,
  });
});
