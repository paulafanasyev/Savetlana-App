import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, requireSeller, ApiError } from "@/lib/auth";
import { sendBuyerToSeller, sendSellerToBuyer } from "@/lib/domains/seller-messages";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

interface Body {
  to?: "seller" | "buyer";
  sellerId?: string;
  buyerId?: string;
  text?: string;
}

/** Отправка сообщения: покупатель пишет магазину или продавец отвечает покупателю. */
export const POST = apiRoute(async (request) => {
  const body = await jsonBody<Body>(request).catch(() => ({} as Body));
  try {
    if (body.to === "seller") {
      const { user } = await requireUser(request);
      if (!rateLimit(`messages:buyer:${user.id}`, 20, 60_000)) return tooManyRequests();
      if (typeof body.sellerId !== "string" || !body.sellerId) throw new ApiError(400, "Не выбран магазин");
      await sendBuyerToSeller({ id: user.id, name: user.name }, body.sellerId, body.text);
      return Response.json({ ok: true });
    }
    if (body.to === "buyer") {
      const { sellerId } = await requireSeller(request);
      if (!rateLimit(`messages:seller:${sellerId}`, 30, 60_000)) return tooManyRequests();
      if (typeof body.buyerId !== "string" || !body.buyerId) throw new ApiError(400, "Не выбран покупатель");
      await sendSellerToBuyer(sellerId, body.buyerId, body.text);
      return Response.json({ ok: true });
    }
    throw new ApiError(400, "Неизвестный получатель");
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
