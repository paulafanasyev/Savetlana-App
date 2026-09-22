import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { createReview } from "@/lib/domains/reviews";
import { audit } from "@/lib/domains/audit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request) => {
  const { user } = await requireBuyer(request);
  const body = await jsonBody<{
    productId?: string;
    orderId?: string;
    rating?: number;
    body?: string;
  }>(request);

  if (!body.productId) {
    return Response.json({ error: "Укажите товар", code: "bad_product" }, { status: 400 });
  }

  try {
    const created = await createReview({
      authorId: user.id,
      productId: body.productId,
      orderId: body.orderId,
      rating: Number(body.rating ?? 0),
      body: String(body.body ?? ""),
    });
    await audit({
      actorId: user.id,
      actorRole: user.role.toLowerCase(),
      action: "review.create",
      targetType: "product",
      targetId: body.productId,
      after: { reviewId: created.id, verifiedPurchase: created.verifiedPurchase },
    });
    return Response.json(created, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Не удалось создать отзыв";
    const code = message.includes("не найден") || message.includes("слишком") || message.includes("оценка") ? "bad_review" : "api_error";
    return Response.json({ error: message, code }, { status: 400 });
  }
});
