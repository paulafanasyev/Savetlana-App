import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { adviseOnPrice, applyPriceChange, priceHistory, pricePosition } from "@/lib/domains/pricing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("pricing:read", 20, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) throw new ApiError(400, "Укажите productId");

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId: ctx.sellerId },
  });
  if (!product) throw new ApiError(404, "Товар не найден в вашем каталоге");

  const [position, advice, history] = await Promise.all([
    pricePosition(productId),
    adviseOnPrice(productId),
    priceHistory(productId),
  ]);
  return Response.json({ position, advice, history });
});

/**
 * Applies a price change. A substantial commercial action like this is only
 * performed after the seller's explicit confirmation (spec §19, §147) — the AI
 * may advise, never silently apply.
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("pricing:apply", 10, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const body = await jsonBody<{
    productId?: string;
    newPriceRubles?: number;
    confirm?: boolean;
  }>(request);

  if (!body.productId) throw new ApiError(400, "Укажите productId");
  if (typeof body.newPriceRubles !== "number" || body.newPriceRubles <= 0) {
    throw new ApiError(400, "Укажите новую цену");
  }
  // The confirmation flag keeps an AI suggestion from becoming a real change.
  if (body.confirm !== true) {
    throw new ApiError(400, "Изменение цены требует явного подтверждения продавца");
  }

  const product = await prisma.product.findFirst({
    where: { id: body.productId, sellerId: ctx.sellerId },
  });
  if (!product) throw new ApiError(404, "Товар не найден в вашем каталоге");

  const result = await applyPriceChange({
    productId: body.productId,
    sellerId: ctx.sellerId,
    actorId: ctx.user.id,
    actorRole: "seller",
    newPriceKopecks: Math.round(body.newPriceRubles * 100),
    confirmed: true,
  });
  return Response.json(result);
});
