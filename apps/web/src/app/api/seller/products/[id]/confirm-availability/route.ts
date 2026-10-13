import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireVerifiedSeller } from "@/lib/auth";
import { confirmAvailability } from "@/lib/domains/inventory";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, { params }) => {
  const { user, sellerId } = await requireVerifiedSeller(request, "подтверждать наличие");
  const body = await jsonBody<{ quantity?: number; extendDays?: number }>(request).catch(() => ({}) as { quantity?: number; extendDays?: number });
  const result = await confirmAvailability(params.id, user.id, {
    sellerId,
    quantity: typeof body.quantity === "number" ? body.quantity : undefined,
    extendDays: typeof body.extendDays === "number" ? body.extendDays : undefined,
  });
  return Response.json(result);
});
