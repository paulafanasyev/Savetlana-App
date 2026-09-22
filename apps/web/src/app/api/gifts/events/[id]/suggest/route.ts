import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer, ApiError } from "@/lib/auth";
import { suggestGifts } from "@/lib/domains/gifts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request, ctx) => {
  if (!rateLimit("gifts:suggest", 20, 60_000)) return tooManyRequests();
  const auth = await requireBuyer(request);

  const event = await prisma.giftEvent.findUniqueOrThrow({
    where: { id: ctx.params.id },
  });
  // A user may only request suggestions for their own saved events.
  if (event.creatorId !== auth.user.id) {
    throw new ApiError(403, "Нет доступа к этому событию");
  }

  const result = await suggestGifts(ctx.params.id);
  return Response.json(result);
});
