import { apiRoute } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fromKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  const products = await prisma.product.findMany({
    where: { sellerId },
    include: {
      images: { take: 1, orderBy: { position: "asc" } },
      inventory: true,
      listing: true,
      category: { select: { name: true, slug: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return Response.json({
    items: products.map((p) => ({
      id: p.id,
      title: p.title,
      sku: p.sku,
      photo: p.images[0]?.url ?? null,
      category: p.category?.name ?? null,
      priceKopecks: p.priceKopecks,
      priceRub: fromKopecks(p.priceKopecks),
      status: p.status,
      aiDraft: p.aiDraft,
      views: p.views,
      ordersCount: p.ordersCount,
      conversion: p.views > 0 ? p.ordersCount / p.views : 0,
      rating: p.rating,
      quantity: p.inventory?.quantity ?? 0,
      availability: p.inventory?.availability ?? "UNKNOWN",
      confirmedBySeller: p.inventory?.confirmedBySeller ?? false,
      confirmedAt: p.inventory?.confirmedAt ?? null,
      saleUntil: p.inventory?.saleUntil ?? null,
      autoExtend: p.inventory?.autoExtend ?? false,
      listingIsLive: p.listing?.isLive ?? false,
      listingExpiresAt: p.listing?.expiresAt ?? null,
    })),
  });
});
