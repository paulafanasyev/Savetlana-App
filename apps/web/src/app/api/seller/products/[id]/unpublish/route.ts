import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, { params }) => {
  const { user, sellerId } = await requireSeller(request);
  if (!rateLimit(`seller-product-unpublish:${sellerId}`, 30, 60_000)) return tooManyRequests();
  const { id } = await Promise.resolve(params);
  const product = await prisma.product.findFirst({ where: { id, sellerId }, select: { id: true, status: true } });
  if (!product) throw new ApiError(404, "Товар не найден в вашем каталоге");
  await prisma.$transaction([
    prisma.product.update({ where: { id }, data: { status: "HIDDEN" } }),
    prisma.listing.updateMany({ where: { productId: id }, data: { isLive: false } }),
    prisma.listingHistory.create({ data: { productId: id, sellerId, actorId: user.id, action: "HIDDEN", change: JSON.stringify({ from: product.status, to: "HIDDEN" }) } }),
  ]);
  return Response.json({ ok: true, status: "HIDDEN" });
});
