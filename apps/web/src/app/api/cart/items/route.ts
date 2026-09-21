import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { addToCart } from "@/lib/domains/cart";
import { recordEvent } from "@/lib/domains/events";

export const POST = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ productId?: string; quantity?: number }>(request);
  if (!body.productId) {
    return Response.json({ error: "Укажите productId", code: "bad_product" }, { status: 400 });
  }
  try {
    const view = await addToCart(user.id, body.productId, Number(body.quantity ?? 1));
    await recordEvent({
      userId: user.id,
      type: "CART_ADD",
      productId: body.productId,
      payload: { quantity: body.quantity ?? 1 },
    });
    return Response.json({
      ok: true,
      totalUnits: view.totalUnits,
      sellerCount: view.sellerCount,
      totalKopecks: view.totalKopecks,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Не удалось добавить товар", code: "add_failed" },
      { status: 400 }
    );
  }
});
