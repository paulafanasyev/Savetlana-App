import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { setCartLineQuantity } from "@/lib/domains/cart";

export const dynamic = "force-dynamic";

export const PATCH = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ quantity?: number }>(request);
  const quantity = Number(body.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 99) {
    return Response.json({ error: "Количество должно быть от 0 до 99", code: "bad_quantity" }, { status: 400 });
  }
  const view = await setCartLineQuantity(user.id, params.id, quantity);
  return Response.json({ ok: true, totalUnits: view.totalUnits });
});

export const DELETE = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  const view = await setCartLineQuantity(user.id, params.id, 0);
  return Response.json({ ok: true, totalUnits: view.totalUnits });
});
