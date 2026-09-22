import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { priceHistory } from "@/lib/domains/pricing";

export const dynamic = "force-dynamic";

/**
 * Price history for a product (spec §54). Reconstructed from the immutable
 * listing-history audit trail — no invented discount narrative.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("price-history:read", 60, 60_000)) return tooManyRequests();
  const ctx = await requireUser(request);
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) return Response.json({ points: [] });

  const points = await priceHistory(productId);
  return Response.json({ points, requestedBy: ctx.user.id });
});
