import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { attachEvidence, getDisputeCase } from "@/lib/domains/disputes";

export const dynamic = "force-dynamic";

/**
 * Links an already-uploaded storage object (via /api/storage/upload) to the
 * dispute case. The storage layer validated mime, size and hash beforehand.
 */
export const POST = apiRoute(async (request, ctx) => {
  if (!rateLimit("disputes:evidence", 10, 60_000)) return tooManyRequests();
  const auth = await requireUser(request);
  const body = await jsonBody<{
    kind?: string;
    storageKey?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    contentHash?: string;
  }>(request);

  if (!body.storageKey || !body.fileName || !body.contentHash) {
    return Response.json({ error: "Неполные данные файла" }, { status: 400 });
  }

  const dispute = await getDisputeCase(ctx.params.id, auth.user.id, auth.user.role);
  if (!dispute) return Response.json({ error: "Спор не найден" }, { status: 404 });

  const ev = await attachEvidence(ctx.params.id, auth.user.id, {
    kind: body.kind ?? "document",
    storageKey: body.storageKey,
    fileName: body.fileName,
    mimeType: body.mimeType ?? "application/octet-stream",
    sizeBytes: body.sizeBytes ?? 0,
    contentHash: body.contentHash,
  });
  return Response.json({ evidence: ev });
});
