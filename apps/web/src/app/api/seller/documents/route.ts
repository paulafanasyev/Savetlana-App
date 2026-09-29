/**
 * Seller documents (spec §20, §81, P0-11).
 *
 * Two upload paths:
 *   1. multipart/form-data — the file goes through the platform storage
 *      pipeline (sniffing, size limit, hash, private bucket). Preferred.
 *   2. JSON with an existing fileUrl/hash — for a client that already uploaded
 *      through /api/storage/upload. Still validated the same way.
 *
 * Either way the record starts as UPLOADED and moves to PENDING_REVIEW; legal
 * validity is never concluded from OCR (spec §20).
 */
import { apiRoute, rateLimit, tooManyRequests, jsonBody } from "@/lib/api-helpers";
import { requireSeller, ApiError } from "@/lib/auth";
import { listDocuments, requirementsForSeller, uploadDocument } from "@/lib/domains/documents";
import { storeUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

async function uploadToPrivateBucket(request: Request, sellerId: string) {
  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  const title = String(form.get("title") ?? "");
  if (!(file instanceof File)) throw new ApiError(400, "Файл не передан");
  if (!kind) throw new ApiError(400, "Укажите тип документа");
  if (!title.trim()) throw new ApiError(400, "Укажите название документа");

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storeUpload({
    bucket: `documents/${sellerId}`,
    filename: `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)}`,
    bytes,
    declaredMimeType: file.type || undefined,
    storageClass: "private",
  });
  return {
    kind,
    title: title.trim(),
    fileUrl: stored.url,
    storageKey: stored.key,
    fileHash: stored.sha256,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
  };
}

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
 * Registers a document. Multipart uploads are stored through the private
 * storage pipeline; JSON payloads accept an already-stored file. Legal
 * validity is never concluded from OCR alone — the document moves to
 * PENDING_REVIEW for a human or official-source check (spec §20).
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("documents:upload", 10, 60_000)) return tooManyRequests();
  const ctx = await requireSeller(request);

  let payload: {
    kind: string;
    title: string;
    fileUrl: string;
    storageKey?: string;
    fileHash: string;
    mimeType: string;
    sizeBytes: number;
    expiresAt?: string;
  };

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    payload = { ...(await uploadToPrivateBucket(request, ctx.sellerId)), expiresAt: undefined };
  } else {
    const body = await jsonBody<{
      kind?: string;
      title?: string;
      fileUrl?: string;
      storageKey?: string;
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
    payload = {
      kind: body.kind,
      title: body.title.trim(),
      fileUrl: body.fileUrl.trim(),
      storageKey: body.storageKey,
      fileHash: body.fileHash.trim(),
      mimeType: body.mimeType as string,
      sizeBytes: body.sizeBytes,
      expiresAt: body.expiresAt,
    };
  }

  const doc = await uploadDocument({
    sellerId: ctx.sellerId,
    kind: payload.kind as never,
    title: payload.title,
    fileUrl: payload.fileUrl,
    storageKey: payload.storageKey,
    fileHash: payload.fileHash,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
  });
  return Response.json({ document: doc }, { status: 201 });
});
