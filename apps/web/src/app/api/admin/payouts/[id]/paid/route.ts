import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireAdmin } from "@/lib/auth";
import { markRegistryPayoutPaid, RegistryPayoutError } from "@/lib/domains/payout-registry";

export const dynamic = "force-dynamic";

/** Администратор отмечает выплату оплаченной по номеру платёжного поручения. */
export const POST = apiRoute(async (request, { params }) => {
  if (!rateLimit("admin:payout-mark", 60, 60_000)) return tooManyRequests();
  const { user } = await requireAdmin(request);
  const body = await jsonBody<{ documentNumber?: string }>(request);
  try {
    return Response.json(await markRegistryPayoutPaid({ payoutId: params.id, adminId: user.id, documentNumber: String(body.documentNumber ?? "") }));
  } catch (error) {
    if (error instanceof RegistryPayoutError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
    throw error;
  }
});
