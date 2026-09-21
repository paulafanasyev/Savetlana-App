import { apiRoute } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { sellerReport } from "@/lib/domains/seller-analytics";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  const report = await sellerReport(sellerId);
  return Response.json(report);
});
