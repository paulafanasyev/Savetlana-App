import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { RELATIONSHIP_TYPES, declareRelationship, getVerifiedCircle } from "@/lib/domains/relationships";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("relationships:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);

  // Declared/pending links belong to the user; only VERIFIED ones are facts.
  const [declared, verifiedCircle] = await Promise.all([
    prisma.relationship.findMany({
      where: { fromUserId: ctx.user.id },
      orderBy: { createdAt: "desc" },
    }),
    getVerifiedCircle(ctx.user.id),
  ]);

  return Response.json({ declared, verifiedCircle });
});

/**
 * One side declares a link. It becomes PENDING_CONFIRMATION — never VERIFIED —
 * until the other person confirms it themselves (spec §16).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("relationships:declare", 10, 60_000)) return tooManyRequests();
  const ctx = await requireBuyer(request);
  const body = await jsonBody<{ toUserId?: string; type?: string; note?: string }>(request);

  if (!body.toUserId) throw new ApiError(400, "Укажите пользователя");
  if (!body.type || !RELATIONSHIP_TYPES.includes(body.type as never)) {
    throw new ApiError(400, `Недопустимый тип связи. Допустимо: ${RELATIONSHIP_TYPES.join(", ")}`);
  }

  const target = await prisma.user.findUnique({ where: { id: body.toUserId } });
  if (!target) throw new ApiError(404, "Пользователь не найден");

  const result = await declareRelationship(ctx.user.id, body.toUserId, body.type, body.note);
  return Response.json(result, { status: 201 });
});
