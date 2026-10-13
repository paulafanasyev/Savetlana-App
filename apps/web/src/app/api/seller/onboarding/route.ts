import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { getSellerVerificationStatus, submitSellerOnboarding } from "@/lib/domains/seller-verification";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  return Response.json(await getSellerVerificationStatus(sellerId));
});

export const POST = apiRoute(async (request) => {
  const { user, sellerId } = await requireSeller(request);
  const body = await jsonBody<Record<string, unknown>>(request);
  try {
    const result = await submitSellerOnboarding(sellerId, {
      sellerType: body.sellerType as "SELF_EMPLOYED" | "IP" | "COMPANY",
      displayName: String(body.displayName ?? ""),
      inn: String(body.inn ?? ""),
      ogrn: body.ogrn ? String(body.ogrn) : undefined,
    }, user.id);
    return Response.json({ status: "PENDING", recordId: result.record.id });
  } catch (error) {
    if (error instanceof ZodError) throw new ApiError(400, error.issues[0]?.message ?? "Проверьте данные");
    throw new ApiError(400, error instanceof Error ? error.message : "Проверьте данные");
  }
});
