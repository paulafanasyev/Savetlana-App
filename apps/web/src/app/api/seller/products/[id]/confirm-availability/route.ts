import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { confirmAvailability } from "@/lib/domains/inventory";

export const dynamic = "force-dynamic";

/**
 * Direct (non-AI) seller action. The UI button and the AI tool share the same
 * domain function, so behaviour and audit logging are identical.
 */
export const POST = apiRoute(async (request, { params }) => {
  const { user, sellerId } = await requireSeller(request);
  const body = await jsonBody<{ quantity?: number; extendDays?: number }>(request);

  const result = await confirmAvailability(params.id, user.id, {
    sellerId,
    quantity: typeof body.quantity === "number" ? body.quantity : undefined,
    extendDays: typeof body.extendDays === "number" ? body.extendDays : undefined,
  });
  return Response.json(result);
});
