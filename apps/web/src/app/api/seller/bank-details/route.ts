import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireSeller } from "@/lib/auth";
import { bankDetailsSummary, saveBankDetails } from "@/lib/domains/bank-details";

export const dynamic = "force-dynamic";

/** Реквизиты для выплат: продавец видит только последние 4 цифры счёта. */
export const GET = apiRoute(async (request) => {
  const { sellerId } = await requireSeller(request);
  return Response.json({ details: await bankDetailsSummary(sellerId) });
});

export const POST = apiRoute(async (request) => {
  const { sellerId, user } = await requireSeller(request);
  if (!rateLimit(`bank-details:${sellerId}`, 10, 60 * 60_000)) return tooManyRequests();
  const raw = await jsonBody<Record<string, unknown>>(request);
  const result = await saveBankDetails({ sellerId, actorId: user.id, raw: raw && typeof raw === "object" ? raw : {} });
  if (!result.ok) {
    return Response.json({ error: "Проверьте реквизиты", code: "invalid_bank_details", fields: result.errors }, { status: 400 });
  }
  return Response.json({ ok: true, accountMasked: result.accountMasked });
});
