import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { getSellerOnboardingGate } from "@/lib/domains/seller-onboarding";
import { planDraftPublish, publishDrafts, publishGateReason } from "@/lib/domains/seller-publish";

export const dynamic = "force-dynamic";

/**
 * Опубликовать все готовые черновики. dryRun (по умолчанию) только показывает,
 * какие готовы и чего не хватает остальным. Публикация требует confirm: true
 * и проверенного продавца, как и публикация одной карточки.
 */
export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  const body = await jsonBody<{ dryRun?: boolean; confirm?: boolean; productIds?: unknown }>(request).catch(
    () => ({}) as { dryRun?: boolean; confirm?: boolean; productIds?: unknown }
  );
  const gate = await getSellerOnboardingGate(sellerId);
  const gateReason = publishGateReason(gate);

  if (body.dryRun !== false) {
    const plan = await planDraftPublish(sellerId);
    return Response.json({ ...plan, gateReason });
  }

  if (gateReason) throw new ApiError(403, gateReason);
  if (body.confirm !== true) throw new ApiError(400, "Публикация требует явного подтверждения продавца");
  const decision = await consumeRateLimit(`publish-all:${sellerId}`, 20, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);

  let productIds: string[];
  if (Array.isArray(body.productIds)) {
    productIds = body.productIds.filter((id): id is string => typeof id === "string");
  } else {
    productIds = (await planDraftPublish(sellerId)).ready.map((item) => item.productId);
  }
  if (productIds.length === 0) throw new ApiError(400, "Нет черновиков, готовых к публикации");
  const result = await publishDrafts({ sellerId, actorId: user.id, productIds });
  return Response.json(result);
});
