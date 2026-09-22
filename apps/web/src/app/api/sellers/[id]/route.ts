import { apiRoute } from "@/lib/api-helpers";
import { getPublicSellerProfile, listSellerProducts } from "@/lib/domains/sellers";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (_request, ctx) => {
  const profile = await getPublicSellerProfile(ctx.params.id);
  if (!profile) {
    return Response.json({ error: "Продавец не найден", code: "seller_not_found" }, { status: 404 });
  }
  const products = await listSellerProducts(profile.id);
  return Response.json({ profile, products });
});
