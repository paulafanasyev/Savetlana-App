import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { markRegistryPayoutReturned, RegistryPayoutError } from "@/lib/domains/payout-registry";

export const dynamic = "force-dynamic";

/** Банк вернул перевод: выплата отменяется, деньги снова доступны продавцу. */
export const POST = apiRoute(async (request, { params }) => {
  if (!rateLimit("admin:payout-mark", 60, 60_000)) return tooManyRequests();
  const { user } = await requireAdmin(request);
  const body = await jsonBody<{ reason?: string }>(request);
  try {
    return Response.json(await markRegistryPayoutReturned({ payoutId: params.id, adminId: user.id, reason: String(body.reason ?? "") }));
  } catch (error) {
    if (error instanceof RegistryPayoutError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
    throw error;
  }
});
