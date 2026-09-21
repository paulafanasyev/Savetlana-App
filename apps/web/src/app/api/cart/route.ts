import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { getCartView } from "@/lib/domains/cart";
import { fromKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const view = await getCartView(user.id);
  return Response.json({
    cartId: view.id,
    totalKopecks: view.totalKopecks,
    totalRub: fromKopecks(view.totalKopecks),
    totalUnits: view.totalUnits,
    sellerCount: view.sellerCount,
    lines: view.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      title: l.title,
      quantity: l.quantity,
      priceKopecks: l.priceKopecks,
      available: l.available,
      sellerName: l.sellerName,
      lineTotalKopecks: l.lineTotalKopecks,
    })),
  });
});
