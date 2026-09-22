import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { listDocuments, requirementsForSeller, uploadDocument } from "@/lib/domains/documents";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export const GET = apiRoute(async (request) => {
  if (!rateLimit("documents:read", 30, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const [documents, requirements] = await Promise.all([
    listDocuments(ctx.sellerId),
    requirementsForSeller(ctx.sellerId),
  ]);
  return Response.json({ documents, requirements });
});

/**
 * Registers an uploaded document. The file bytes are expected to already be in
 * storage (signed-URL upload flow); this endpoint records the metadata and
 * starts processing. Legal validity is never concluded from OCR alone — the
 * document moves to PENDING_REVIEW for a human or official-source check
 * (spec §20).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("documents:upload", 10, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);
  const body = await jsonBody<{
    kind?: string;
    title?: string;
    fileUrl?: string;
    fileHash?: string;
    mimeType?: string;
    sizeBytes?: number;
    expiresAt?: string;
  }>(request);

  if (!body.kind) throw new ApiError(400, "Укажите тип документа");
  if (!body.title?.trim()) throw new ApiError(400, "Укажите название документа");
  if (!body.fileUrl?.trim()) throw new ApiError(400, "Файл не загружен");
  if (!body.fileHash?.trim()) throw new ApiError(400, "Отсутствует хеш файла");
  if (!ALLOWED_MIME.includes(body.mimeType ?? "")) {
    throw new ApiError(400, "Неподдерживаемый тип файла");
  }
  if (!body.sizeBytes || body.sizeBytes <= 0) throw new ApiError(400, "Укажите размер файла");

  const doc = await uploadDocument({
    sellerId: ctx.sellerId,
    kind: body.kind as never,
    title: body.title.trim(),
    fileUrl: body.fileUrl.trim(),
    fileHash: body.fileHash.trim(),
    mimeType: body.mimeType as string,
    sizeBytes: body.sizeBytes,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
  });
  return Response.json({ document: doc }, { status: 201 });
});
