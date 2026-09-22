import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { addFavorite, removeFavorite, listFavorites } from "@/lib/domains/collections";
import { fromKopecks } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const items = await listFavorites(user.id);
  return Response.json({
    totalUnits: items.length,
    items: items.map((p) => ({ ...p, priceRub: fromKopecks(p.priceKopecks) })),
  });
});

export const POST = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ productId?: string }>(request);
  if (!body.productId) return Response.json({ error: "Укажите товар", code: "bad_product" }, { status: 400 });
  await addFavorite(user.id, body.productId);
  return Response.json({ ok: true });
});

export const DELETE = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return Response.json({ error: "Укажите товар", code: "bad_product" }, { status: 400 });
  await removeFavorite(user.id, productId);
  return Response.json({ ok: true });
});
