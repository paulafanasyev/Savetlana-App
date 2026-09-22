import { apiRoute } from "@/lib/api-helpers";
import { listReviews, summarizeReviews } from "@/lib/domains/reviews";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request, ctx) => {
  const productId = ctx.params.id;
  const url = new URL(request.url);
  const summary = url.searchParams.get("summary") === "1";
  if (summary) {
    const s = await summarizeReviews(productId);
    return Response.json(s);
  }
  const items = await listReviews(productId);
  return Response.json({ totalUnits: items.length, items });
});
