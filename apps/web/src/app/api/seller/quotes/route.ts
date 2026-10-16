import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { decideQuote, listSellerQuotes } from "@/lib/domains/b2b-quotes";

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

export const GET = apiRoute(async (request) => {
  if (!rateLimit("quotes:seller:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  return Response.json({ quotes: await listSellerQuotes(ctx.sellerId) });
});

/** Продавец подтверждает или отклоняет КП своего агента. */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("quotes:seller:decide", 20, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const body = await jsonBody<{ quoteId?: string; decision?: string }>(request);
  if (!body.quoteId) throw new ApiError(400, "Укажите КП");
  if (body.decision !== "confirm" && body.decision !== "decline") throw new ApiError(400, "Решение: confirm или decline");
  const quoteId = body.quoteId;
  const accept = body.decision === "confirm";
  const quote = await userFacing(() => decideQuote(quoteId, ctx.sellerId, ctx.user.id, accept));
  return Response.json({ status: quote.status });
});
