import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { getSellerNegotiationPolicy, saveSellerNegotiationPolicy } from "@/lib/domains/negotiation-policy";

export const dynamic = "force-dynamic";

/** Правила B2B-торга своего кабинета: видит и меняет только сам продавец. */
export const GET = apiRoute(async (request) => {
  if (!rateLimit("negotiation:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  return Response.json({ policy: await getSellerNegotiationPolicy(ctx.sellerId) });
});

export const POST = apiRoute(async (request) => {
  if (!rateLimit("negotiation:write", 10, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const body = await jsonBody<Record<string, unknown>>(request);
  const policy = await saveSellerNegotiationPolicy(ctx.sellerId, ctx.user.id, body);
  return Response.json({ policy });
});
