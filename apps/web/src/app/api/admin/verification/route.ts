import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireAdmin, ApiError } from "@/lib/auth";
import { listVerificationQueue, decideVerification } from "@/lib/domains/admin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  if (!rateLimit("admin:verification", 30, 60_000)) return tooManyRequests();
  await requireAdmin(request);
  return Response.json({ items: await listVerificationQueue(100) });
});

/**
 * Manual verification decision. The record is always stamped
 * source=manual_review so it can never be confused with an official
 * ESIA/FNS check (spec §49 — no fake verification).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("admin:verification-decision", 10, 60_000)) return tooManyRequests();
  const ctx = await requireAdmin(request);
  const body = await jsonBody<{
    sellerId?: string;
    kind?: string;
    approved?: boolean;
    note?: string;
  }>(request);

  if (!body.sellerId) throw new ApiError(400, "Укажите sellerId");
  if (!body.kind) throw new ApiError(400, "Укажите kind (identity | npd | business | document)");
  if (typeof body.approved !== "boolean") throw new ApiError(400, "Укажите approved");

  return Response.json(
    await decideVerification(body.sellerId, body.kind, body.approved, body.note, ctx.user.id)
  );
});
