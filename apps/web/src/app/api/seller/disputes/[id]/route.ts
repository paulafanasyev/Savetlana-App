import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { redirect } from "next/navigation";
import { requireSeller, ApiError } from "@/lib/auth";
import { collectEvidence, transitionDispute } from "@/lib/domains/disputes";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Seller-side dispute response. The seller may propose a resolution or concede;
 * a dispute that needs legal judgement must be escalated to a human arbiter
 * rather than decided by AI (spec §42, §91).
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("disputes:transition", 10, 60_000)) return tooManyRequests();
  const sellerCtx = await requireSeller(request);
  const body = await jsonBody<{ to?: string; resolution?: string }>(request).catch(
    () => ({}) as { to?: string; resolution?: string }
  );

  const to = body.to ?? "RESOLVED_SELLER";
  if (!["RESOLVED_BUYER", "RESOLVED_SELLER", "ESCALATED_HUMAN", "CLOSED"].includes(to)) {
    throw new ApiError(400, "Укажите целевой статус спора");
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: ctx.params.id } });
  if (!dispute) throw new ApiError(404, "Спор не найден");
  if (dispute.sellerId !== sellerCtx.sellerId) throw new ApiError(403, "Нет доступа к этому спору");

  if (to === "ESCALATED_HUMAN") {
    await collectEvidence(dispute.id, sellerCtx.user.id);
  }

  await transitionDispute(
    dispute.id,
    sellerCtx.user.id,
    "seller",
    to as never,
    body.resolution
  );
  return redirect(`/seller/disputes`);
});
