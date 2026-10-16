import { apiRoute } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { confirmReceipt } from "@/lib/domains/safe-deal-actions";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

/** Безопасная сделка: покупатель принимает товар, деньги становятся доступны продавцу. */
export const POST = apiRoute(async (request, { params }) => {
  const { user } = await requireBuyer(request);
  try {
    const result = await confirmReceipt(params.id, user.id);
    return Response.json({ ok: true, status: result.status });
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
