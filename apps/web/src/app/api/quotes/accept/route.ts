import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { acceptQuote } from "@/lib/domains/b2b-quotes";

export const dynamic = "force-dynamic";

/** Ошибки домена показываем человеку как есть, с их кодом. */
async function userFacing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError((e as { status?: number }).status ?? 400, e.message);
    throw e;
  }
}

/** Покупатель оформляет заказ по подтверждённому продавцом КП. */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("quotes:accept", 10, 60_000)) return tooManyRequests();
  const { user } = await requireUser(request);
  const body = await jsonBody<{ quoteId?: string }>(request);
  if (!body.quoteId) throw new ApiError(400, "Укажите КП");
  const quoteId = body.quoteId;
  const order = await userFacing(() => acceptQuote(quoteId, user.id));
  return Response.json(order);
});
