import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { addToCart } from "@/lib/domains/cart";
import { recordEvent } from "@/lib/domains/events";

export const POST = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{ productId?: string; quantity?: number; variantId?: string | null }>(request);
  if (!body.productId) {
    return Response.json({ error: "Укажите товар", code: "bad_product" }, { status: 400 });
  }
  try {
    const variantId = typeof body.variantId === "string" && body.variantId ? body.variantId : null;
    const view = await addToCart(user.id, body.productId, Number(body.quantity ?? 1), variantId);
    await recordEvent({
      userId: user.id,
      type: "CART_ADD",
      productId: body.productId,
      payload: { quantity: body.quantity ?? 1, variantId },
    });
    return Response.json({
      ok: true,
      totalUnits: view.totalUnits,
      sellerCount: view.sellerCount,
      totalKopecks: view.totalKopecks,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Не удалось добавить товар";
    return Response.json(
      { error: message.charAt(0).toUpperCase() + message.slice(1), code: "add_failed" },
      { status: 400 }
    );
  }
});
