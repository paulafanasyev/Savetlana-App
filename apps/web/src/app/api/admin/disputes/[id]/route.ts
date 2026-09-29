import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { assignAdmin, getDisputeCase, resolveDispute } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request, ctx) => {
  await requireAdmin(request);
  const dispute = await getDisputeCase(ctx.params.id, "admin", "admin");
  if (!dispute) throw new ApiError(404, "Спор не найден");
  return Response.json({ dispute });
});

export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("admin:dispute:act", 10, 60_000)) return tooManyRequests();
  const auth = await requireAdmin(request);

  // Admin forms are HTML form-encoded; the JSON shape is kept for API clients.
  const raw: Record<string, string> = request.headers
    .get("content-type")
    ?.includes("application/json")
    ? await jsonBody<Record<string, string>>(request)
    : Object.fromEntries(
        (await request.formData()).entries().map(([k, v]) => [k, String(v)]),
      );

  const action = raw.action;
  const refundRub = Number(raw.refundRub ?? 0);

  if (action === "assign") {
    const d = await assignAdmin(ctx.params.id, auth.user.id);
    return Response.json({ dispute: d });
  }

  if (action === "resolve") {
    // Form buttons encode the winner: resolve_buyer / resolve_seller.
    const winner: "buyer" | "seller" | undefined = raw.winner
      ? (raw.winner as "buyer" | "seller")
      : action.startsWith("resolve_")
        ? (action.slice("resolve_".length) as "buyer" | "seller")
        : undefined;
    if (!winner || !raw.reasonCode || !raw.resolution) {
      throw new ApiError(400, "Укажите winner, reasonCode и resolution");
    }
    const result = await resolveDispute({
      disputeId: ctx.params.id,
      actorId: auth.user.id,
      winner,
      reasonCode: raw.reasonCode,
      resolution: raw.resolution,
      refundAmountKopecks: Number.isFinite(refundRub) && refundRub > 0
        ? Math.round(refundRub * 100)
        : undefined,
    });
    return Response.json(result);
  }

  throw new ApiError(400, "Неизвестное действие");
});
