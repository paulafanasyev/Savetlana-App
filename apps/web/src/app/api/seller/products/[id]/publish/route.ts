import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { redirect } from "next/navigation";
import { requireVerifiedSeller, ApiError } from "@/lib/auth";
import { toolRegistry } from "@/lib/ai/tools";
// Importing the tool index also bootstraps the registry (registerAllTools).
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Publishes a draft card. Publishing is a legally significant action: the
 * seller must have reviewed the AI-prepared draft, the request carries an
 * explicit confirm flag (spec §12, §147), and the seller must have cleared
 * the verification machine (P0 fix, spec §19/§21).
 */
export const POST = apiRoute(async (request, routeCtx) => {
  if (!rateLimit("ai:publish", 10, 60_000)) return tooManyRequests();
  const ctx = await requireVerifiedSeller(request, "публиковать товары");
  const body = await jsonBody<{ confirm?: boolean }>(request).catch(
    () => ({}) as { confirm?: boolean }
  );

  const productId = routeCtx.params.id;
  const product = await prisma.product.findFirst({ where: { id: productId, sellerId: ctx.sellerId } });
  if (!product) throw new ApiError(404, "Товар не найден в вашем каталоге");

  const tool = toolRegistry.get("publish_product");
  if (!tool) throw new ApiError(503, "Инструмент публикации недоступен");

  if (body.confirm !== true) {
    throw new ApiError(400, "Публикация требует явного подтверждения продавца");
  }

  const result = await tool.execute(
    {
      userId: ctx.user.id,
      role: "seller",
      sellerProfileId: ctx.sellerId,
      traceId: `api-publish-${productId}`,
      confirm: async () => true,
    },
    { productId }
  );

  if (!result.ok) {
    throw new ApiError(400, result.error ?? "Не удалось опубликовать товар");
  }

  return redirect(`/seller/products`);
});
