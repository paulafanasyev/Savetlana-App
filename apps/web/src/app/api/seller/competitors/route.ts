import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { findCompetitors, findCompetitorSellers } from "@/lib/domains/competitors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Competitor intelligence for one of the seller's own products. Uses only
 * publicly available offers in the marketplace catalog — never another
 * seller's private cabinet data (spec §13, §26).
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("competitors:read", 20, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) throw new ApiError(400, "Укажите productId");

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId: ctx.sellerId },
  });
  if (!product) throw new ApiError(404, "Товар не найден в вашем каталоге");

  const report = await findCompetitors(productId);
  return Response.json(report);
});
