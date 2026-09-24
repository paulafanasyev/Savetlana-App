import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { scanExternalCompetitors } from "@/lib/domains/external-search";
import { prisma } from "@/lib/prisma";
import type { ScanTier } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";

/**
 * Global competitor scan for one of the seller's products (spec §13, §26).
 *
 * Svetlana analyses competitors across the whole internet, not only inside the
 * platform: tier 1 = Россия (Ozon, Wildberries + платформа), tier 2 = глобально
 * (AliExpress, Taobao, Amazon). Every external offer is persisted as a price
 * history and the verdict states the seller's real market position.
 */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("competitors:scan", 10, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const url = new URL(request.url);

  const productId = url.searchParams.get("productId");
  if (!productId) throw new ApiError(400, "Укажите productId");

  // The seller may only scan their own catalogue; a buyer cannot use this to
  // inspect another seller's internals.
  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId: ctx.sellerId },
    select: { id: true },
  });
  if (!product) throw new ApiError(404, "Товар не найден в вашем каталоге");

  const tierRaw = url.searchParams.get("tier");
  let tier: ScanTier = 1;
  if (tierRaw === "2") tier = 2;
  else if (tierRaw !== null && tierRaw !== "1")
    throw new ApiError(400, "Уровень сканирования должен быть 1 (Россия) или 2 (глобально)");

  const scan = await scanExternalCompetitors(productId, {
    tier,
    limit: Number(url.searchParams.get("limit") ?? "10"),
  });
  return Response.json(scan);
});
